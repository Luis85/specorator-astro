import { Modal, Setting, type App } from 'obsidian';
import type { ComponentKind } from '../core/domain/component-transpile';

/** What the modal collects to scaffold a new component note (FR-11h). */
export interface ComponentNoteRequest {
	name: string;
	kind: ComponentKind;
}

/**
 * A small native modal for the "Create component" command (FR-11h): it collects
 * the component name + kind (view | layout | partial) and hands a
 * {@link ComponentNoteRequest} to `onSubmit`. Pure UI — the composition root
 * builds the note text (pure `buildComponentNote`) and writes it into the
 * library folder via the Vault API. No filesystem or domain logic here.
 */
export class ComponentNoteModal extends Modal {
	private name = '';
	private kind: ComponentKind = 'view';

	constructor(
		app: App,
		private readonly onSubmit: (request: ComponentNoteRequest) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Create component note' });
		contentEl.createEl('p', {
			text: 'Scaffolds a component note (frontmatter + an astro code-fence) in your component library folder. The component runs at build time once you grant consent.',
		});

		new Setting(contentEl).setName('Name').addText((text) => {
			text.setPlaceholder('Component name').onChange((value) => {
				this.name = value;
			});
		});

		new Setting(contentEl).setName('Kind').addDropdown((dropdown) => {
			dropdown.addOption('view', 'View component');
			dropdown.addOption('layout', 'Layout');
			dropdown.addOption('partial', 'Partial');
			dropdown.setValue(this.kind).onChange((value) => {
				this.kind =
					value === 'layout' ? 'layout' : value === 'partial' ? 'partial' : 'view';
			});
		});

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText('Create')
				.setCta()
				.onClick(() => {
					if (this.name.trim() === '') return;
					this.close();
					this.onSubmit({ name: this.name, kind: this.kind });
				}),
		);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
