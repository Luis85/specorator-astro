import { FuzzySuggestModal, type App } from 'obsidian';

/**
 * A native fuzzy picker that lists a `.base` file's view names for the
 * "Add to Specorator site" command (the #1 onboarding affordance). Pure UI: it
 * only presents the pre-enumerated view names (computed by the pure core
 * `listViewNames`) and hands the chosen name to the `onChoose` callback the
 * composition root wires to the publish-list append. No filesystem, YAML
 * parsing, or domain logic lives here.
 *
 * The caller is responsible for the empty/single-view shortcuts: with zero views
 * it should fall back to a default target (and never open this modal), and with
 * exactly one view it should choose that view directly. This modal exists for the
 * "pick one of several" case.
 */
export class AddToSiteModal extends FuzzySuggestModal<string> {
	constructor(
		app: App,
		private readonly viewNames: readonly string[],
		private readonly onChoose: (viewName: string) => void,
	) {
		super(app);
		this.setPlaceholder('Pick a view to publish to your site');
	}

	override getItems(): string[] {
		return [...this.viewNames];
	}

	override getItemText(viewName: string): string {
		return viewName;
	}

	override onChooseItem(viewName: string): void {
		this.onChoose(viewName);
	}
}
