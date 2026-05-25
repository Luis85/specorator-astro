import { Modal, Setting, type App } from 'obsidian';
import type { StubKind } from '../core/domain/scaffold-stub';

/** What the scaffold modal collects: the kind to scaffold and a registry name. */
export interface ScaffoldRequest {
	kind: StubKind;
	name: string;
}

/**
 * A small native modal that collects the inputs for the "Scaffold
 * component/layout" command (FR-11d): the kind (view | layout) and the registry
 * name. Pure UI — it only gathers a {@link ScaffoldRequest} and hands it to the
 * `onSubmit` callback the composition root wires to the `ScaffoldPort`. No
 * filesystem or domain logic here.
 */
export class ScaffoldModal extends Modal {
	private kind: StubKind = 'view';
	private name = '';

	constructor(
		app: App,
		private readonly onSubmit: (request: ScaffoldRequest) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Scaffold component/layout' });
		contentEl.createEl('p', {
			text: 'Creates a user-owned .astro stub under src/user/ (an existing file is never overwritten). Assign it to a view in settings, then run a sync.',
		});

		new Setting(contentEl).setName('Kind').addDropdown((dropdown) => {
			dropdown.addOption('view', 'View component');
			dropdown.addOption('layout', 'Layout');
			dropdown.setValue(this.kind).onChange((value) => {
				this.kind = value === 'layout' ? 'layout' : 'view';
			});
		});

		new Setting(contentEl).setName('Name').addText((text) => {
			text.setPlaceholder('Component name').onChange((value) => {
				this.name = value;
			});
		});

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText('Create')
				.setCta()
				.onClick(() => {
					if (this.name.trim() === '') {
						return;
					}
					this.close();
					this.onSubmit({ kind: this.kind, name: this.name });
				}),
		);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
