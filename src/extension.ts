import * as vscode from 'vscode';
import { PixelAgentsViewProvider } from './PixelAgentsViewProvider.js';
import { VIEW_ID, COMMAND_SHOW_PANEL, COMMAND_EXPORT_DEFAULT_LAYOUT } from './constants.js';

let providerInstance: PixelAgentsViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
	const provider = new PixelAgentsViewProvider(context);
	providerInstance = provider;

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(VIEW_ID, provider)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND_SHOW_PANEL, () => {
			vscode.commands.executeCommand(`${VIEW_ID}.focus`);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND_EXPORT_DEFAULT_LAYOUT, () => {
			provider.exportDefaultLayout();
		})
	);

	if (context.extensionMode === vscode.ExtensionMode.Development) {
		let attempts = 0;
		const timer = setInterval(() => {
			attempts += 1;
			void vscode.commands.executeCommand('workbench.view.extension.pixel-agents-panel');
			void vscode.commands.executeCommand(COMMAND_SHOW_PANEL);
			if (attempts >= 4) {
				clearInterval(timer);
			}
		}, 500);
		context.subscriptions.push({ dispose: () => clearInterval(timer) });
	}
}

export function deactivate() {
	providerInstance?.dispose();
}
