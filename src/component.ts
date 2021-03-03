import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';

type EventFrame = {
	component: string;
	event: string;
	value: any;
};

type ApiCallFrame = {
	component: string;
	id: string;
	endpoint: string;
	params: Record<string, any>;
};

type ApiResultFrame = {
	component: string;
	id: string;
	value: any;
};

type ComponentEntry = {
	ctx: ComponentContext;
	start: () => Promise<void>;
};

export interface Component {
	name: string;
	start(ctx: ComponentContext): Promise<void>;
}

export class ComponentEngine {
	private entries: Record<string, ComponentEntry> = { };

	event: EventEmitter;

	constructor() {
		this.event = new EventEmitter();
	}

	private registerEntry(component: Component) {
		const ctx = new ComponentContext(this, component.name);
		const entry: ComponentEntry = {
			ctx: ctx,
			start: () => component.start(ctx)
		};
		this.entries[component.name] = entry;
	}

	use(component: Component) {
		this.registerEntry(component);
	}

	start() {
		for (const [name, entry] of Object.entries(this.entries)) {
			entry.start()
			.catch(err => {
				console.log(err);
			});
		}
	}
}

export type EndpointInfo = {
	name: string;
	params: {
		name: string;
		test?: (value: any) => boolean;
		validator?: any;
	}[];
};

export class EndpointContext {
	params: Record<string, any>;

	constructor(params: Record<string, any>) {
		this.params = params;
	}
}

export class ComponentContext {
	name: string;
	private engine: ComponentEngine;

	private eventHandlers: { component: string, event: string, listener: (value: any) => void }[];
	private rootEventHandler: (frame: EventFrame) => void;

	private apis: { endpoint: string, handler: (ctx: EndpointContext) => Promise<any> }[];
	private rootApiHandler: (frame: ApiCallFrame) => void;

	constructor(engine: ComponentEngine, name: string) {
		this.name = name;
		this.engine = engine;

		this.eventHandlers = [];
		this.rootEventHandler = (frame: EventFrame) => {
			const listeners = this.eventHandlers.filter(item => {
				return (item.component == frame.component && item.event == frame.event);
			});
			for (const listener of listeners) {
				listener.listener(frame.value);
			}
		};

		this.apis = [];
		this.rootApiHandler = (frame: ApiCallFrame) => {
			if (frame.component != this.name) {
				return;
			}
			const api = this.apis.find(item => item.endpoint == frame.endpoint);
			if (!api) {
				return;
			}
			api.handler(new EndpointContext(frame.params))
			.then(result => {
				const resultFrame: ApiResultFrame = {
					component: this.name,
					id: frame.id,
					value: result
				};
				this.engine.event.emit('api-result', resultFrame);
			})
			.catch(err => {
				console.log(err);
			});
		};

		this.engine.event.addListener('event', this.rootEventHandler);
		this.engine.event.addListener('api-call', this.rootApiHandler);
	}

	private getListenerIndex(component: string, event: string, listener: (value: any) => void) {
		return this.eventHandlers.findIndex(item => {
			return (item.component == component && item.event == event && item.listener == listener);
		});
	}

	addListener(component: string, event: string, listener: (value: any) => void) {
		if (this.getListenerIndex(component, event, listener) != -1) {
			return;
		}
		this.eventHandlers.push({
			component,
			event,
			listener
		});
	}

	removeListener(component: string, event: string, listener: (value: any) => void) {
		const index = this.getListenerIndex(component, event, listener);
		if (index == -1) {
			return;
		}
		this.eventHandlers.splice(index, 1);
	}

	send(event: string, value: any) {
		const frame: EventFrame = {
			component: this.name,
			event: event,
			value: value
		};
		this.engine.event.emit('event', frame);
	}

	// setup: (ctx: EndpointContext) => void
	addEndpoint(info: EndpointInfo, handler: (ctx: EndpointContext) => Promise<any>) {

		const index = this.apis.findIndex(item => item.endpoint == info.name);
		if (index != -1) {
			throw new Error('endpoint name is already used.');
		}
		this.apis.push({ endpoint: info.name, handler });
	}

	removeEndpoint(name: string) {
		const index = this.apis.findIndex(item => item.endpoint == name);
		if (index == -1) {
			throw new Error('endpoint is not found.');
		}
		this.apis.splice(index, 1);
	}

	call(component: string, endpoint: string, params?: Record<string, any>, timeout?: number) {
		return new Promise<any>((resolve, reject) => {
			params = params ?? { };
			timeout = timeout ?? 1000;

			const id = uuid();
			let timeoutHandle: NodeJS.Timeout | null = null;

			//console.log('listenerCount', this.engine.event.listenerCount('api-result'));

			// api result handling
			function listener(resultFrame: ApiResultFrame) {
				if (resultFrame.id != id) {
					return;
				}
				if (timeoutHandle) {
					//console.log('clear timeout');
					clearTimeout(timeoutHandle);
				}
				resolve(resultFrame.value);
			}
			this.engine.event.once('api-result', listener);

			// api timeout handling
			timeoutHandle = setTimeout(() => {
				//console.log('timeout');
				this.engine.event.removeListener('api-result', listener);
				reject(new Error('timeout'));
			}, timeout);

			// api calling
			const callFrame: ApiCallFrame = {
				component, id, endpoint, params
			};

			this.engine.event.emit('api-call', callFrame);
		});
	}

	dispose() {
		this.engine.event.removeListener('event', this.rootEventHandler);
		this.engine.event.removeListener('api-call', this.rootApiHandler);
	}
}
