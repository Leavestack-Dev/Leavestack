import { v4 as uuid } from 'uuid';
import { ComponentEngine, Component, ComponentContext } from '.';
import { sleep } from './util';

class NotesComponent implements Component {
	name = 'notes';

	async start(ctx: ComponentContext) {

		let user: Record<string, any> | null = null;
		while (true) {
			try {
				user = await ctx.call('users', 'getUser');
				if (user) break;
				await sleep(1000);
			}
			catch (err) {
				console.log('timeout');
			}
		}
		console.log('user', user);

	}
}

class UsersComponent implements Component {
	name = 'users';

	async start(ctx: ComponentContext) {

		ctx.addEndpoint({
			name: 'getUser',
			params: []
		}, async (ctx) => {
			return {
				id: uuid(),
				name: 'abc',
				description: 'hello'
			};
		});

	}
}

const engine = new ComponentEngine();
engine.use(new NotesComponent());
engine.use(new UsersComponent());
engine.start();
