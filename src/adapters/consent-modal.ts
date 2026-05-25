import { Modal, Setting, type App } from 'obsidian';

/** The decision the consent modal returns: grant, revoke, or dismiss (no change). */
export type ConsentDecision = 'grant' | 'revoke' | 'dismiss';

/**
 * One-time **build-execution consent** prompt for the vault code-fence component
 * library (FR-18 / D11; DESIGN §5.10). It DISCLOSES plainly that component notes
 * become real modules executed at build time with **no sandbox**, then lets the
 * user grant (open the gate) or revoke (close it). Pure UI: it only collects a
 * {@link ConsentDecision} and hands it to `onDecide`; the composition root
 * persists it through the settings store.
 *
 * Crucially this must NOT claim a sandbox (FR-18). The copy states the real
 * trust model: the vault author is trusted; importing someone else's component
 * notes is the risk, exactly like running their source.
 */
export class ConsentModal extends Modal {
	constructor(
		app: App,
		private readonly currentlyGranted: boolean,
		private readonly onDecide: (decision: ConsentDecision) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Enable the component library?' });

		contentEl.createEl('p', {
			text: 'The component library lets you author Astro components as notes in your component folder. Each note holds an `astro` code-fence that is transpiled into a real component.',
		});
		// The honest disclosure — no sandbox claim (FR-18).
		const warning = contentEl.createEl('p');
		warning.createEl('strong', {
			text: 'These components run at build time with no sandbox. ',
		});
		warning.appendText(
			'A component note can import code, read files, and run processes — exactly like project source. Only enable this for notes you trust; importing component notes authored by someone else (synced, shared, downloaded) is the real risk.',
		);

		contentEl.createEl('p', {
			text: this.currentlyGranted
				? 'Consent is currently GRANTED. You can revoke it at any time; revoking stops new components from being generated.'
				: 'Consent is currently NOT granted. Until you grant it, code-fence component notes do nothing — the bundled safe theme components are used.',
		});

		const buttons = new Setting(contentEl);
		if (this.currentlyGranted) {
			buttons.addButton((button) =>
				button
					.setButtonText('Revoke consent')
					.setWarning()
					.onClick(() => {
						this.close();
						this.onDecide('revoke');
					}),
			);
		} else {
			buttons.addButton((button) =>
				button
					.setButtonText('I understand — enable')
					.setCta()
					.onClick(() => {
						this.close();
						this.onDecide('grant');
					}),
			);
		}
		buttons.addButton((button) =>
			button.setButtonText('Cancel').onClick(() => {
				this.close();
				this.onDecide('dismiss');
			}),
		);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
