import type { Command } from "obsidian";

export interface SessionCommandDefinition<TSession> {
	id: string;
	name: string;
	isEnabled?: (session: TSession) => boolean;
	run: (session: TSession) => unknown;
}

export type CommandRegistrar = (command: Command) => void;

export function registerSessionCommands<TSession>(
	register: CommandRegistrar,
	resolveSession: () => TSession | null | undefined,
	definitions: readonly SessionCommandDefinition<TSession>[]
): void {
	for (const definition of definitions) {
		register({
			id: definition.id,
			name: definition.name,
			checkCallback: (checking: boolean) => {
				const session = resolveSession();
				if (!session) {
					return false;
				}
				const canRun = definition.isEnabled?.(session) ?? true;
				if (canRun && !checking) {
					void definition.run(session);
				}
				return canRun;
			}
		});
	}
}
