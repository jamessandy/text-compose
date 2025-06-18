/**
 * @fileoverview Control real time music with text prompts for different musical parts.
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {css, CSSResultGroup, html, LitElement, svg, TemplateResult} from 'lit';
import {customElement, property, query, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {styleMap} from 'lit/directives/style-map.js';

import {
  GoogleGenAI,
  type LiveMusicGenerationConfig,
  type LiveMusicServerMessage,
  type LiveMusicSession,
  type WeightedPrompt,
} from '@google/genai';
import {decode, decodeAudioData} from './utils';

// Use API_KEY as per guidelines
const ai = new GoogleGenAI({
  apiKey: process.env.API_KEY,
  apiVersion: 'v1alpha',
});
let model = 'lyria-realtime-exp';

interface Track {
  readonly trackId: string;
  name: string;
  readonly color: string;
  text: string; // This is the prompt for the track
  weight: number;
}

type PlaybackState = 'stopped' | 'playing' | 'loading' | 'paused';

/** Throttles a callback to be called at most once per `freq` milliseconds. */
function throttle(func: (...args: unknown[]) => void, delay: number) {
  let lastCall = 0;
  return (...args: unknown[]) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;
    if (timeSinceLastCall >= delay) {
      func(...args);
      lastCall = now;
    }
  };
}

const INITIAL_TRACK_DESCRIPTIONS: Record<string, string> = {
  'Drums': 'Upbeat electronic drums, driving kick, crisp hi-hats',
  'Bassline': 'Funky syncopated electric bass, warm tone',
  'Harmony': 'Lush ambient pads, sustained chords, smooth transitions',
  'Melody': 'Simple catchy synth lead, slightly detuned, expressive vibrato',
};


const COLORS = [
  '#FF6B6B', // Light Red/Coral
  '#FFD166', // Light Orange/Yellow
  '#06D6A0', // Green/Mint
  '#118AB2', // Blue
  '#7A28CB', // Purple
  '#EF476F', // Pink
  '#F78C6B', // Salmon
  '#6A4C93', // Dark Purple
];


function getUnusedRandomColor(usedColors: string[]): string {
  const availableColors = COLORS.filter((c) => !usedColors.includes(c));
  if (availableColors.length === 0) {
    return COLORS[Math.floor(Math.random() * COLORS.length)];
  }
  return availableColors[Math.floor(Math.random() * availableColors.length)];
}

// --- NEW HorizontalWeightControl Component ---
@customElement('horizontal-weight-control')
class HorizontalWeightControl extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      align-items: center;
      width: 100%;
      height: 30px; /* Adjust height as needed */
      cursor: ew-resize;
      position: relative;
      padding: 5px 0;
      box-sizing: border-box;
    }
    .track-bar {
      width: 100%;
      height: 12px; /* Thickness of the bar */
      background-color: #333; /* Darker background for the track */
      border-radius: 6px;
      position: relative;
      overflow: hidden;
    }
    .fill-bar {
      position: absolute;
      left: 0;
      top: 0;
      height: 100%;
      border-radius: 6px 0 0 6px; /* Keep left radius */
      background-color: var(--track-color, #5200ff);
    }
    .thumb {
      width: 20px; /* Size of the thumb */
      height: 20px;
      background-color: #fff; /* Thumb color */
      border: 2px solid var(--track-color, #5200ff); /* Border matching track color */
      border-radius: 50%;
      position: absolute;
      top: 50%;
      transform: translate(-50%, -50%); /* Center thumb on the line */
      box-shadow: 0 0 5px rgba(0,0,0,0.5);
      z-index: 1;
    }
    .thumb:hover {
        transform: translate(-50%, -50%) scale(1.1);
    }
  `;

  @property({type: Number}) value = 0; // Range 0-2
  @property({type: String}) color = '#5200ff';

  @query('.track-bar') private trackBar!: HTMLDivElement;
  private isDragging = false;

  private handlePointerDown(e: PointerEvent) {
    if (e.button !== 0) return; // Only main button
    e.preventDefault();
    this.isDragging = true;
    this.updateValueFromPosition(e.clientX);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp, {once: true});
    document.body.classList.add('dragging-horizontal');
  }

  private handlePointerMove = (e: PointerEvent) => {
    if (this.isDragging) {
      this.updateValueFromPosition(e.clientX);
    }
  };

  private handlePointerUp = () => {
    this.isDragging = false;
    window.removeEventListener('pointermove', this.handlePointerMove);
    document.body.classList.remove('dragging-horizontal');
  };

  private updateValueFromPosition(clientX: number) {
    const rect = this.trackBar.getBoundingClientRect();
    let normalizedValue = (clientX - rect.left) / rect.width;
    normalizedValue = Math.max(0, Math.min(1, normalizedValue)); // Clamp 0-1
    this.value = normalizedValue * 2; // Scale to 0-2
    this.dispatchInputEvent();
  }

  private dispatchInputEvent() {
    this.dispatchEvent(new CustomEvent<number>('input', {detail: this.value}));
  }

  override render() {
    const fillPercent = (this.value / 2) * 100;
    const thumbPositionPercent = Math.min(100, Math.max(0, (this.value / 2) * 100)); // Ensure thumb stays within bounds

    return html`
      <div class="track-bar" @pointerdown=${this.handlePointerDown} style="--track-color: ${this.color};">
        <div class="fill-bar" style="width: ${fillPercent}%;"></div>
        <div class="thumb" style="left: ${thumbPositionPercent}%;"></div>
      </div>
    `;
  }
}


// --- WeightSlider (Vertical - to be removed or replaced) ---
// This component is no longer used and can be removed. For this diff, I'll leave it commented out
// or explicitly state its removal if the file size becomes an issue.
// For now, it's unused.

// Base class for icon buttons. (no changes needed for its core, but might need style tweaks for new context)
class IconButton extends LitElement {
  static override styles = css`
    :host {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none; /* Pointer events handled by .hitbox */
    }
    :host(:hover) svg {
      transform: scale(1.1); /* Slightly smaller hover effect */
    }
    svg {
      width: 100%;
      height: 100%;
      transition: transform 0.3s cubic-bezier(0.25, 1.56, 0.32, 0.99);
    }
    .hitbox {
      pointer-events: all;
      position: absolute;
      width: 100%; /* Make hitbox cover the whole SVG area */
      height: 100%;
      top: 0;
      left: 0;
      border-radius: 50%;
      cursor: pointer;
    }
  ` as CSSResultGroup;

  protected renderIcon(): TemplateResult {
    return svg``;
  }

  // Simplified SVG shell for general icon buttons
  private renderSVGShell(icon: TemplateResult) {
    return html` <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg">
      ${icon}
    </svg>`;
  }

  override render() {
    // The complex filter/shadow SVG is removed for generic icon buttons.
    // Specific buttons like PlayPause can define their own complex SVG if needed.
    return html`${this.renderSVGShell(this.renderIcon())}<div class="hitbox"></div>`;
  }
}

// PlayPauseButton (Adjusted styles for bottom panel)
@customElement('play-pause-button')
export class PlayPauseButton extends IconButton {
  @property({type: String}) playbackState: PlaybackState = 'stopped';

  static override styles = [
    IconButton.styles,
    css`
      :host {
        width: 50px; /* Example size, adjust as needed */
        height: 50px;
      }
      svg {
        fill: #FEFEFE; /* Icon color */
      }
      .loader {
        stroke: #ffffff;
        stroke-width: 2; /* Adjusted for smaller size */
        stroke-linecap: round;
        animation: spin linear 1s infinite;
        transform-origin: center;
        transform-box: fill-box;
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(359deg); }
      }
    `,
  ];

  private renderPause() {
    return svg`<path d="M9 19H7V5H9V19ZM17 5V19H15V5H17Z"/>`;
  }
  private renderPlay() {
    return svg`<path d="M7 5V19L19 12L7 5Z"/>`;
  }
  private renderLoading() {
     return svg`<circle class="loader" cx="12" cy="12" r="8" fill="none" stroke-width="2"/>`;
  }

  override renderIcon() {
    if (this.playbackState === 'playing') return this.renderPause();
    if (this.playbackState === 'loading') return this.renderLoading();
    return this.renderPlay();
  }
}

// ResetButton (Adjusted styles for bottom panel)
@customElement('reset-button')
export class ResetButton extends IconButton {
   static override styles = [
    IconButton.styles,
    css`
      :host {
        width: 40px; /* Example size */
        height: 40px;
      }
      svg {
        fill: #FEFEFE;
      }
    `,
  ];
  private renderResetIcon() {
    return svg`<path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>`;
  }
  override renderIcon() {
    return this.renderResetIcon();
  }
}

// AddTrackButton (Replaced by an inline icon button in PromptDj)
// This custom element might not be needed if we use a simpler button.
// For now, let it be, but PromptDj will use a simpler inline SVG for the add track button.

// Toast Message component (no changes needed)
@customElement('toast-message')
class ToastMessage extends LitElement {
  static override styles = css`
    .toast {
      line-height: 1.6;
      position: fixed;
      bottom: 90px; /* Position above bottom controls */
      left: 50%;
      transform: translateX(-50%);
      background-color: #111; /* Darker background */
      color: white;
      padding: 12px 18px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 15px;
      min-width: 200px;
      max-width: 80vw;
      box-shadow: 0 4px 15px rgba(0,0,0,0.3);
      transition: transform 0.5s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.5s;
      z-index: 1100; /* Ensure it's above other elements */
      opacity: 0;
      pointer-events: none;
    }
    .toast.showing {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
      pointer-events: auto;
    }
    button {
      background: none;
      color: #aaa;
      border:none;
      font-size: 18px;
      cursor: pointer;
    }
    button:hover {
      color: white;
    }
    .toast:not(.showing) {
      transition-duration: 1s;
      transform: translate(-50%, 100px); /* Slide down when hiding */
      opacity: 0;
    }
  `;

  @property({type: String}) message = '';
  @property({type: Boolean, reflect: true}) showing = false;

  override render() {
    return html`<div class=${classMap({showing: this.showing, toast: true})}>
      <div class="message">${this.message}</div>
      <button @click=${this.hide} aria-label="Close toast message">✕</button>
    </div>`;
  }

  show(message: string) {
    this.message = message;
    this.showing = true;
    setTimeout(() => { if (this.showing) this.hide(); }, 5000); // Auto-hide after 5s
  }

  hide() {
    this.showing = false;
  }
}


/** A single track input controller - Redesigned for Horizontal Layout */
@customElement('track-controller')
class TrackController extends LitElement {
  static override styles = css`
    :host {
      display: block;
      margin-bottom: 12px; /* Space between tracks */
      width: 100%; /* Take full width of its container */
      max-width: 700px; /* Max width for a track */
    }
    .track-card {
      background-color: #2C2C2E; /* Dark card background from inspiration */
      border-radius: 12px; /* Rounded corners */
      padding: 12px 18px;
      display: flex;
      flex-direction: column; /* Stack internal elements vertically */
      gap: 8px;
      position: relative;
      border: 1px solid #3a3a3c; /* Subtle border */
    }
    .top-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .track-name-input {
      font-family: 'Google Sans', sans-serif;
      font-size: 16px; /* Prominent name */
      font-weight: 500;
      color: var(--track-color, #fff); /* Use track color */
      background-color: transparent;
      border: none;
      outline: none;
      padding: 4px 0;
      flex-grow: 0; /* Don't grow, let weight control take space */
      min-width: 100px; /* Ensure some space for name */
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      border-bottom: 1px solid transparent;
    }
    .track-name-input:focus {
      border-bottom: 1px solid var(--track-color, #fff);
    }
    .weight-control-container {
      flex-grow: 1; /* Allow weight control to take available space */
    }
    .remove-button {
      background: #444;
      color: #ccc;
      border: none;
      border-radius: 50%;
      width: 28px;
      height: 28px;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background-color 0.2s, color 0.2s;
      flex-shrink: 0;
    }
    .remove-button:hover {
      background-color: #ff3b30; /* Red hover for delete */
      color: white;
    }
    #prompt-text {
      font-family: 'Google Sans', sans-serif;
      font-size: 13px;
      width: 100%;
      min-height: 3em; /* Allow for a couple of lines */
      padding: 8px;
      box-sizing: border-box;
      border: 1px solid #3a3a3c;
      border-radius: 6px;
      background-color: #1C1C1E; /* Slightly darker input background */
      color: #eee;
      resize: vertical;
      outline: none;
      -webkit-font-smoothing: antialiased;
      scrollbar-width: thin;
      scrollbar-color: #666 #1a1a1a;
    }
    #prompt-text:focus {
        border-color: var(--track-color, #5200ff);
        box-shadow: 0 0 0 1px var(--track-color, #5200ff);
    }
    #prompt-text::-webkit-scrollbar { width: 6px; }
    #prompt-text::-webkit-scrollbar-track { background: #0003; border-radius: 3px; }
    #prompt-text::-webkit-scrollbar-thumb { background-color: #666; border-radius: 3px; }
    :host([filtered='true']) .track-card {
      border-left: 3px solid #da2000;
    }
     .weight-display {
      font-size: 12px;
      color: #aaa;
      margin-left: 8px;
      min-width: 30px; /* Space for "1.00" */
      text-align: right;
    }
  `;

  @property({type: String, reflect: true}) trackId = '';
  @property({type: String}) name = 'Track';
  @property({type: String}) text = '';
  @property({type: Number}) weight = 0;
  @property({type: String}) color = '';
  @property({type: Boolean, reflect: true}) filtered = false;

  @query('horizontal-weight-control') private weightInput!: HorizontalWeightControl;
  @query('#prompt-text') private promptTextInput!: HTMLTextAreaElement; // Changed to textarea
  @query('.track-name-input') private nameInput!: HTMLInputElement;

  private handlePromptTextKeyDown(e: KeyboardEvent) {
    // No specific enter key behavior for textarea, allow new lines
  }
  
  private handleNameKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.updateName();
      (e.target as HTMLElement).blur();
    }
  }

  private dispatchTrackChange() {
    this.dispatchEvent(
      new CustomEvent<Track>('track-changed', {
        detail: {
          trackId: this.trackId,
          name: this.name,
          text: this.text,
          weight: this.weight,
          color: this.color,
        },
      }),
    );
  }

  private updateName() {
    const newName = this.nameInput.value?.trim();
    if (newName === '' || newName === this.name) {
      this.nameInput.value = this.name;
      return;
    }
    this.name = newName;
    this.dispatchTrackChange();
  }

  private updatePromptText() {
    const newText = this.promptTextInput.value?.trim(); // Use .value for textarea
    if (newText === undefined || newText === this.text) {
      return;
    }
    this.text = newText;
    this.dispatchTrackChange();
  }

  private updateWeight() {
    this.weight = this.weightInput.value;
    this.dispatchTrackChange();
  }

  private dispatchTrackRemoved() {
    this.dispatchEvent(
      new CustomEvent<string>('track-removed', {
        detail: this.trackId, bubbles: true, composed: true,
      }),
    );
  }

  override render() {
    const trackCardStyles = styleMap({'--track-color': this.color});
    return html`
      <div class="track-card" style=${trackCardStyles}>
        <div class="top-row">
          <input 
            type="text" 
            class="track-name-input" 
            .value=${this.name} 
            @blur=${this.updateName}
            @keydown=${this.handleNameKeyDown}
            spellcheck="false"
            style="color: ${this.color}; --track-color: ${this.color};"
          />
          <div class="weight-control-container">
            <horizontal-weight-control
              .value=${this.weight}
              .color=${this.color}
              @input=${this.updateWeight}>
            </horizontal-weight-control>
          </div>
          <span class="weight-display">${this.weight.toFixed(2)}</span>
          <button class="remove-button" @click=${this.dispatchTrackRemoved} aria-label="Remove track">×</button>
        </div>
        <textarea
          id="prompt-text"
          spellcheck="false"
          @keydown=${this.handlePromptTextKeyDown}
          @blur=${this.updatePromptText}
          .value=${this.text} 
          placeholder="Describe the instrument, style, and feel..."
          style="--track-color: ${this.color};"
        ></textarea>
      </div>`;
  }
}

/** Settings Panel - Restyled for bottom panel */
@customElement('settings-controller')
class SettingsController extends LitElement {
  static override styles = css`
    :host {
      display: block;
      padding: 10px 15px; /* Compact padding */
      color: #eee;
      font-family: 'Google Sans', sans-serif;
      font-size: 13px; /* Smaller base font size */
      width: 100%;
      box-sizing: border-box;
    }
    .settings-grid {
      display: flex;
      flex-wrap: wrap; /* Allow wrapping for responsiveness */
      gap: 15px 25px; /* Spacing between settings */
      align-items: flex-start;
    }
    .setting-group {
        display: flex;
        flex-direction: column;
        gap: 5px; /* Space between label and input */
    }
    .setting-group.checkbox-group {
      gap: 8px; /* More space for checkbox rows */
      padding-top: 5px; /* Align with other controls better */
    }
    label {
      font-weight: 500;
      font-size: 12px; /* Smaller labels */
      color: #bbb;
      display: flex;
      justify-content: space-between;
      align-items: center;
      white-space: nowrap;
      user-select: none;
    }
    label span:last-child { /* Value display next to label */
      font-weight: normal;
      color: #fff;
      min-width: 2.5em;
      text-align: right;
      margin-left: 8px;
    }
    input[type='range'] {
      --track-height: 6px;
      --track-bg: #444;
      --track-border-radius: 3px;
      --thumb-size: 16px; /* Smaller thumb */
      --thumb-bg: var(--slider-color, #7A28CB); /* Use CSS var for color */
      --thumb-border-radius: 50%;
      --thumb-box-shadow: 0 0 3px rgba(0, 0, 0, 0.5);
      --value-percent: 0%;
      -webkit-appearance: none;
      appearance: none;
      width: 120px; /* Fixed width for sliders */
      height: var(--thumb-size); /* Make height accommodate thumb */
      background: transparent;
      cursor: pointer;
      margin: 0;
      vertical-align: middle;
      padding: 0;
    }
    input[type='range']::-webkit-slider-runnable-track {
      width: 100%;
      height: var(--track-height);
      cursor: pointer;
      background: linear-gradient(
        to right,
        var(--thumb-bg) var(--value-percent),
        var(--track-bg) var(--value-percent)
      );
      border-radius: var(--track-border-radius);
    }
    input[type='range']::-moz-range-track {
      width: 100%;
      height: var(--track-height);
      cursor: pointer;
      background: var(--track-bg);
      border-radius: var(--track-border-radius);
      border: none;
    }
    input[type='range']::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      height: var(--thumb-size);
      width: var(--thumb-size);
      background: var(--thumb-bg);
      border-radius: var(--thumb-border-radius);
      box-shadow: var(--thumb-box-shadow);
      cursor: pointer;
      margin-top: calc((var(--thumb-size) - var(--track-height)) / -2);
      border: 2px solid #2c2c2e; /* Match panel bg for 'pop' */
    }
    input[type='range']::-moz-range-thumb {
      height: var(--thumb-size);
      width: var(--thumb-size);
      background: var(--thumb-bg);
      border-radius: var(--thumb-border-radius);
      box-shadow: var(--thumb-box-shadow);
      cursor: pointer;
      border: 2px solid #2c2c2e;
    }

    input[type='number'],
    input[type='text'],
    select {
      background-color: #3a3a3c;
      color: #eee;
      border: 1px solid #555;
      border-radius: 4px;
      padding: 5px 8px;
      font-size: 13px;
      font-family: inherit;
      box-sizing: border-box;
    }
    input[type='number'] { width: 70px; }
    input[type='text'] { width: 100px; }
    select { width: 150px; } /* Adjust width as needed */

    input[type='number']:focus,
    input[type='text']:focus,
    select:focus {
      outline: none;
      border-color: var(--slider-color, #7A28CB);
      box-shadow: 0 0 0 1px var(--slider-color, #7A28CB);
    }
    
    .checkbox-setting {
      display: flex; align-items: center; gap: 6px;
    }
    input[type='checkbox'] {
      cursor: pointer;
      accent-color: var(--slider-color, #7A28CB);
      width: 14px; height: 14px;
    }
    .checkbox-setting label { font-weight: normal; font-size: 13px; color: #ddd; }

    .advanced-toggle {
      cursor: pointer;
      color: #aaa;
      text-decoration: underline;
      user-select: none;
      font-size: 12px;
      margin-top: 10px;
      grid-column: 1 / -1; /* Span all columns if in grid */
    }
    .advanced-toggle:hover { color: #eee; }

    .advanced-settings {
      display: contents; /* Allows children to participate in parent flex/grid */
    }
    .advanced-settings.hidden > * { display: none; }

    .auto-row { display: flex; align-items: center; gap: 5px; margin-top: 3px;}
    .auto-row label { font-size: 12px; color: #bbb;}
    .auto-row span { font-size: 12px; color: #fff; margin-left: auto;}
    .setting-group[auto='true'] input[type='range'] { filter: grayscale(80%); opacity: 0.7; pointer-events:none;}
  `;
  
  // Default config and state properties remain largely the same
  private readonly defaultConfig: LiveMusicGenerationConfig = { 
    temperature: 1.1, topK: 40, guidance: 4.0,
  };
  @state() private config: LiveMusicGenerationConfig = {...this.defaultConfig};
  @state() showAdvanced = false;
  @state() autoDensity = true;
  @state() lastDefinedDensity: number | undefined = undefined; 
  @state() autoBrightness = true;
  @state() lastDefinedBrightness: number | undefined = undefined; 

  // Methods like resetToDefaults, handleInputChange, dispatchSettingsChange, toggleAdvancedSettings remain structurally similar,
  // but references to specific DOM elements might need minor adjustments if IDs/classes change.
  // The updateSliderBackground method is crucial for the visual feedback on sliders.
   public resetToDefaults() {
    this.config = {...this.defaultConfig};
    this.autoDensity = true;
    this.lastDefinedDensity = undefined;
    this.autoBrightness = true;
    this.lastDefinedBrightness = undefined;
    this.showAdvanced = false; // Also reset advanced view
    this.dispatchSettingsChange();
  }

  private updateSliderBackground(inputEl: HTMLInputElement) {
    if (inputEl.type !== 'range') return;
    const min = Number(inputEl.min) || 0;
    const max = Number(inputEl.max) || 100;
    const value = Number(inputEl.value);
    const percentage = ((value - min) / (max - min)) * 100;
    inputEl.style.setProperty('--value-percent', `${percentage}%`);
    const color = inputEl.dataset.color || '#7A28CB'; // Get color from data attribute or default
    inputEl.style.setProperty('--thumb-bg', color);
    inputEl.style.setProperty('--slider-color', color);
  }

  private handleInputChange(e: Event) {
    const target = e.target as (HTMLInputElement | HTMLSelectElement);
    const key = target.id as keyof LiveMusicGenerationConfig | 'auto-density' | 'auto-brightness';
    let value: string | number | boolean | undefined = (target as HTMLInputElement).value; // Initial value, will be overridden for checkbox/select

    if (target instanceof HTMLInputElement) {
      if (target.type === 'number' || target.type === 'range') {
        value = target.value === '' ? undefined : Number(target.value);
        if (target.type === 'range') {
          this.updateSliderBackground(target);
        }
      } else if (target.type === 'checkbox') {
        value = target.checked;
      }
      // For other HTMLInputElement types, `value` remains as initially set from `target.value`
    } else if (target instanceof HTMLSelectElement && target.type === 'select-one') {
      const selectElement = target; // target is already HTMLSelectElement here due to instanceof
      if (selectElement.options[selectElement.selectedIndex]?.disabled && selectElement.value === "") { 
        value = undefined;
      } else {
        value = selectElement.value;
      }
    }
    
    const newConfig = { ...this.config };

    if (key === 'auto-density') {
        this.autoDensity = Boolean(value);
        newConfig.density = this.autoDensity ? undefined : this.lastDefinedDensity ?? 0.5;
    } else if (key === 'auto-brightness') {
        this.autoBrightness = Boolean(value);
        newConfig.brightness = this.autoBrightness ? undefined : this.lastDefinedBrightness ?? 0.5;
    } else if (key === 'density' && typeof value === 'number') {
        this.lastDefinedDensity = value;
        if (!this.autoDensity) newConfig.density = value;
    } else if (key === 'brightness' && typeof value === 'number') {
        this.lastDefinedBrightness = value;
        if (!this.autoBrightness) newConfig.brightness = value;
    } else if (key in this.defaultConfig || ['bpm', 'seed', 'scale', 'muteBass', 'muteDrums', 'onlyBassAndDrums'].includes(key)) {
        // @ts-ignore
        newConfig[key] = value;
    }

    this.config = newConfig;
    this.dispatchSettingsChange();
  }

  override updated(changedProperties: Map<string | symbol, unknown>) {
    super.updated(changedProperties);
    if (changedProperties.has('config') || changedProperties.has('autoDensity') || changedProperties.has('autoBrightness')) {
      this.shadowRoot
        ?.querySelectorAll<HTMLInputElement>('input[type="range"]')
        .forEach((slider: HTMLInputElement) => {
          const configKey = slider.id as keyof LiveMusicGenerationConfig;
          let configValue = this.config[configKey];

          if (slider.id === 'density') {
            configValue = this.autoDensity ? 0.5 : (this.lastDefinedDensity ?? 0.5);
             slider.disabled = this.autoDensity;
          } else if (slider.id === 'brightness') {
            configValue = this.autoBrightness ? 0.5 : (this.lastDefinedBrightness ?? 0.5);
            slider.disabled = this.autoBrightness;
          }
          
          if (typeof configValue === 'number') {
            slider.value = String(configValue);
          } else if (configValue === undefined && (slider.id === 'density' || slider.id === 'brightness')) {
             slider.value = String(0.5); 
          }
          this.updateSliderBackground(slider);
        });
    }
  }
  
  private dispatchSettingsChange() {
    const configToSend: Partial<LiveMusicGenerationConfig> = {};
    for (const key in this.config) {
        const k = key as keyof LiveMusicGenerationConfig;
        if (this.config[k] !== undefined) {
            // @ts-ignore
            configToSend[k] = this.config[k];
        }
    }
    if (this.autoDensity) delete configToSend.density; else configToSend.density = this.lastDefinedDensity ?? 0.5;
    if (this.autoBrightness) delete configToSend.brightness; else configToSend.brightness = this.lastDefinedBrightness ?? 0.5;
    
    configToSend.temperature = configToSend.temperature ?? this.defaultConfig.temperature;
    configToSend.topK = configToSend.topK ?? this.defaultConfig.topK;
    configToSend.guidance = configToSend.guidance ?? this.defaultConfig.guidance;

    this.dispatchEvent(
      new CustomEvent<LiveMusicGenerationConfig>('settings-changed', {
        detail: configToSend as LiveMusicGenerationConfig,
        bubbles: true, composed: true,
      }),
    );
  }

  private toggleAdvancedSettings() {
    this.showAdvanced = !this.showAdvanced;
  }

  override render() {
    const cfg = this.config;
    const advancedClasses = classMap({
      'advanced-settings': true,
      'hidden': !this.showAdvanced,
    });
    const scaleMap = new Map<string, string>([
      ['Auto', 'SCALE_UNSPECIFIED'], ['C Maj / A Min', 'C_MAJOR_A_MINOR'], ['C# Maj / A# Min', 'D_FLAT_MAJOR_B_FLAT_MINOR'],
      ['D Maj / B Min', 'D_MAJOR_B_MINOR'], ['D# Maj / C Min', 'E_FLAT_MAJOR_C_MINOR'], ['E Maj / C# Min', 'E_MAJOR_D_FLAT_MINOR'],
      ['F Maj / D Min', 'F_MAJOR_D_MINOR'], ['F# Maj / D# Min', 'G_FLAT_MAJOR_E_FLAT_MINOR'], ['G Maj / E Min', 'G_MAJOR_E_MINOR'],
      ['G# Maj / F Min', 'A_FLAT_MAJOR_F_MINOR'], ['A Maj / F# Min', 'A_MAJOR_G_FLAT_MINOR'], ['A# Maj / G Min', 'B_FLAT_MAJOR_G_MINOR'],
      ['B Maj / G# Min', 'B_MAJOR_A_FLAT_MINOR'],
    ]);
    const displayDensity = this.autoDensity ? (cfg.density !== undefined ? `Auto (${cfg.density.toFixed(2)})` : 'Auto') : (this.lastDefinedDensity ?? 0.5).toFixed(2);
    const displayBrightness = this.autoBrightness ? (cfg.brightness !== undefined ? `Auto (${cfg.brightness.toFixed(2)})` : 'Auto') : (this.lastDefinedBrightness ?? 0.5).toFixed(2);

    const sliderColor1 = '#FF6B6B'; // Coral
    const sliderColor2 = '#06D6A0'; // Mint
    const sliderColor3 = '#118AB2'; // Blue
    const sliderColor4 = '#FFD166'; // Yellow
    const sliderColor5 = '#7A28CB'; // Purple


    return html`
      <div class="settings-grid">
        <div class="setting-group">
          <label for="temperature">Temperature<span>${(cfg.temperature ?? this.defaultConfig.temperature!).toFixed(1)}</span></label>
          <input type="range" id="temperature" min="0" max="3" step="0.1" .value=${(cfg.temperature ?? this.defaultConfig.temperature!).toString()} @input=${this.handleInputChange} data-color="${sliderColor1}" />
        </div>
        <div class="setting-group">
          <label for="guidance">Guidance<span>${(cfg.guidance ?? this.defaultConfig.guidance!).toFixed(1)}</span></label>
          <input type="range" id="guidance" min="0" max="6" step="0.1" .value=${(cfg.guidance ?? this.defaultConfig.guidance!).toString()} @input=${this.handleInputChange} data-color="${sliderColor2}" />
        </div>
        <div class="setting-group">
          <label for="topK">Top K<span>${cfg.topK ?? this.defaultConfig.topK!}</span></label>
          <input type="range" id="topK" min="1" max="100" step="1" .value=${(cfg.topK ?? this.defaultConfig.topK!).toString()} @input=${this.handleInputChange} data-color="${sliderColor3}" />
        </div>

        <div class=${advancedClasses}>
            <div class="setting-group" .auto=${this.autoDensity}>
                <label for="density">Density</label>
                <input type="range" id="density" min="0" max="1" step="0.05" .value=${(this.lastDefinedDensity ?? 0.5).toString()} @input=${this.handleInputChange} ?disabled=${this.autoDensity} data-color="${sliderColor4}"/>
                <div class="auto-row">
                    <input type="checkbox" id="auto-density" .checked=${this.autoDensity} @input=${this.handleInputChange} />
                    <label for="auto-density">Auto</label><span>${displayDensity}</span>
                </div>
            </div>
            <div class="setting-group" .auto=${this.autoBrightness}>
                <label for="brightness">Brightness</label>
                <input type="range" id="brightness" min="0" max="1" step="0.05" .value=${(this.lastDefinedBrightness ?? 0.5).toString()} @input=${this.handleInputChange} ?disabled=${this.autoBrightness} data-color="${sliderColor5}"/>
                <div class="auto-row">
                    <input type="checkbox" id="auto-brightness" .checked=${this.autoBrightness} @input=${this.handleInputChange} />
                    <label for="auto-brightness">Auto</label><span>${displayBrightness}</span>
                </div>
            </div>
            <div class="setting-group">
                <label for="bpm">BPM</label>
                <input type="number" id="bpm" min="60" max="180" .value=${cfg.bpm ?? ''} @input=${this.handleInputChange} placeholder="Auto" style="--slider-color: ${sliderColor1};"/>
            </div>
            <div class="setting-group">
                <label for="scale">Key/Scale</label>
                <select id="scale" .value=${cfg.scale || ''} @change=${this.handleInputChange} style="--slider-color: ${sliderColor2};">
                    <option value="" disabled selected hidden>Auto</option>
                    <option value="">Auto</option>
                    ${[...scaleMap.entries()].map(([displayName, enumValue]) => enumValue === 'SCALE_UNSPECIFIED' ? '' : html`<option value=${enumValue}>${displayName}</option>`)}
                </select>
            </div>
            <div class="setting-group">
              <label for="seed">Seed</label>
              <input type="number" id="seed" .value=${cfg.seed ?? ''} @input=${this.handleInputChange} placeholder="Auto" style="--slider-color: ${sliderColor3};"/>
            </div>
            <div class="setting-group checkbox-group">
                <div class="checkbox-setting">
                    <input type="checkbox" id="muteDrums" .checked=${!!cfg.muteDrums} @change=${this.handleInputChange} style="--slider-color: ${sliderColor4};"/>
                    <label for="muteDrums">Mute Drums</label>
                </div>
                <div class="checkbox-setting">
                    <input type="checkbox" id="muteBass" .checked=${!!cfg.muteBass} @change=${this.handleInputChange} style="--slider-color: ${sliderColor5};"/>
                    <label for="muteBass">Mute Bass</label>
                </div>
                <div class="checkbox-setting">
                    <input type="checkbox" id="onlyBassAndDrums" .checked=${!!cfg.onlyBassAndDrums} @change=${this.handleInputChange} style="--slider-color: ${sliderColor1};"/>
                    <label for="onlyBassAndDrums">Bass & Drums Only</label>
                </div>
            </div>
        </div>
      </div>
      <div class="advanced-toggle" @click=${this.toggleAdvancedSettings}>
        ${this.showAdvanced ? 'Hide' : 'Show'} Advanced Settings
      </div>
    `;
  }
}

/** Suggestion Chip component */
@customElement('suggestion-chip')
class SuggestionChip extends LitElement {
  static override styles = css`
    :host { display: inline-block; }
    .chip {
      background-color: #3a3a3c; /* Darker chip background */
      color: #ddd;
      padding: 6px 12px;
      border-radius: 16px; /* Pill shape */
      font-size: 13px;
      cursor: pointer;
      transition: background-color 0.2s, color 0.2s;
      border: 1px solid #555;
      user-select: none;
    }
    .chip:hover {
      background-color: #4f4f52;
      color: white;
    }
  `;

  @property({type: String}) label = '';

  private handleClick() {
    this.dispatchEvent(new CustomEvent('chip-clicked', {detail: this.label, bubbles: true, composed: true}));
  }

  override render() {
    return html`<div class="chip" @click=${this.handleClick} role="button" tabindex="0">${this.label}</div>`;
  }
}


/** Component for the PromptDJ UI. */
@customElement('prompt-dj')
class PromptDj extends LitElement {
  static override styles = css`
    :host {
      height: 100%;
      width: 100%;
      display: flex;
      flex-direction: column;
      background-color: #1C1C1E; /* Main dark background from inspiration */
      color: #fff;
      font-family: 'Google Sans', sans-serif;
      overflow: hidden; /* Prevent body scroll */
    }
    #background { /* Dynamic background, keep subtle */
      position: absolute;
      height: 100%;
      width: 100%;
      z-index: 0;
      background: #1C1C1E; /* Fallback */
      opacity: 0.5; /* Make it less prominent */
      transition: background-image 0.5s ease-in-out;
    }
    .main-content {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      padding: 20px;
      overflow-y: auto; /* Scroll main content if needed, not individual tracks container initially */
      z-index: 1;
      scrollbar-width: thin;
      scrollbar-color: #444 #1C1C1E;
    }
    .main-content::-webkit-scrollbar { width: 8px; }
    .main-content::-webkit-scrollbar-track { background: #1C1C1E; }
    .main-content::-webkit-scrollbar-thumb { background-color: #444; border-radius: 4px; }

    #tracks-container { 
      display: flex;
      flex-direction: column; /* Stack tracks vertically */
      align-items: center; /* Center tracks horizontally */
      gap: 0; /* Let track-controller handle its margin */
      width: 100%;
      margin-bottom: 20px; /* Space before add track section */
    }
    
    .add-track-section {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 15px;
      background-color: #2C2C2E; /* Slightly lighter bg for this section */
      border-radius: 12px;
      margin-bottom: 20px;
      width: 100%;
      max-width: 700px; /* Match track controller max width */
      align-self: center;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    }
    #new-track-input {
      flex-grow: 1;
      background-color: #3a3a3c;
      color: #eee;
      border: 1px solid #555;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 14px;
      outline: none;
    }
    #new-track-input:focus {
      border-color: #7A28CB; /* Accent color on focus */
      box-shadow: 0 0 0 1px #7A28CB;
    }
    #add-track-icon-button {
      background-color: #7A28CB; /* Accent color for add button */
      color: white;
      border: none;
      border-radius: 8px; /* Match input field */
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    #add-track-icon-button:hover {
      background-color: #5c1f99;
    }
    #add-track-icon-button svg {
      width: 20px;
      height: 20px;
    }
    .suggestion-chips-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 0 15px 15px 15px; /* Padding for chips below input */
      justify-content: center;
      width: 100%;
      max-width: 700px;
      align-self: center;
      margin-bottom: 10px;
    }

    #bottom-controls-panel {
      background-color: #2C2C2E; /* Dark panel background */
      padding: 10px 15px;
      display: flex;
      align-items: center;
      justify-content: space-between; /* Space out settings and playback */
      flex-wrap: wrap; /* Allow wrapping on smaller screens */
      gap:15px;
      border-top: 1px solid #3a3a3c; /* Subtle top border */
      box-shadow: 0 -2px 10px rgba(0,0,0,0.2);
      z-index: 10; /* Keep on top */
    }
    .settings-controller-wrapper {
        flex-grow: 1; /* Allow settings to take available space */
    }
    .playback-controls-wrapper {
      display: flex;
      align-items: center;
      gap: 15px; /* Space between play/pause and reset */
      flex-shrink: 0;
    }
    /* Default size for icons in the bottom panel */
    #bottom-controls-panel play-pause-button { width: 44px; height: 44px; }
    #bottom-controls-panel reset-button { width: 36px; height: 36px; }
  `;

  // --- State and Properties ---
  @property({type: Object, attribute: false}) private tracks: Map<string, Track>; 
  private nextTrackId: number; 
  private session!: LiveMusicSession; 
  private readonly sampleRate = 48000;
  private audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: this.sampleRate});
  private outputNode: GainNode = this.audioContext.createGain();
  private nextStartTime = 0;
  private readonly bufferTime = 2; 
  @state() private playbackState: PlaybackState = 'stopped';
  @property({type: Object}) private filteredTrackTexts = new Set<string>(); 
  private connectionError = true;
  @query('#new-track-input') private newTrackInput!: HTMLInputElement;
  @query('toast-message') private toastMessage!: ToastMessage;
  @query('settings-controller') private settingsController!: SettingsController;

  private suggestionPrompts = [
    "Synth Arp", "Lo-fi Drums", "Ambient Pad", "Funky Bassline", "Piano Melody", 
    "Guitar Riff", "Strings Section", "808 Kick", "Vocal Chop", "Jazz Chords"
  ];

  constructor(tracks: Map<string, Track>) { 
    super();
    this.tracks = tracks;
    this.nextTrackId = this.tracks.size; 
    if (this.tracks.size > 0) {
        const maxId = Math.max(...Array.from(this.tracks.keys()).map(id => parseInt(id.split('-')[1] || '0', 10)));
        this.nextTrackId = isNaN(maxId) ? this.tracks.size : maxId + 1;
    } else {
        this.nextTrackId = 0;
    }
    this.outputNode.connect(this.audioContext.destination);
  }

  override async firstUpdated() {
    await this.connectToSession();
    this.setSessionWeightedPrompts(); 
  }

  // --- Core Methods (connectToSession, setSessionWeightedPrompts, etc.) ---
  // These methods remain largely the same, but prompt text format might need adjustment
  // if we decide to include track names in the prompt sent to the API differently.
  // For now, the prompt format `${track.name}: ${track.text}` is kept.
  private async connectToSession() {
    try {
        this.session = await ai.live.music.connect({
        model: model,
        callbacks: {
            onmessage: async (e: LiveMusicServerMessage) => {
            console.log('Received message from the server: %s\n', e);
            if (e.setupComplete) this.connectionError = false;
            if (e.filteredPrompt) { 
                this.filteredTrackTexts = new Set([...this.filteredTrackTexts, e.filteredPrompt.text]);
                this.toastMessage.show(e.filteredPrompt.filteredReason);
                this.requestUpdate('filteredTrackTexts');
            }
            if (e.serverContent?.audioChunks !== undefined) {
                if (this.playbackState === 'paused' || this.playbackState === 'stopped') return;
                const audioBuffer = await decodeAudioData(
                decode(e.serverContent?.audioChunks[0].data), this.audioContext, 48000, 2);
                const source = this.audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(this.outputNode);
                if (this.nextStartTime === 0) {
                this.nextStartTime = this.audioContext.currentTime + this.bufferTime;
                setTimeout(() => { if (this.playbackState === 'loading') this.playbackState = 'playing';}, this.bufferTime * 1000);
                }
                if (this.nextStartTime < this.audioContext.currentTime) {
                console.log('Audio underrun');
                this.playbackState = 'loading'; 
                this.nextStartTime = this.audioContext.currentTime + this.bufferTime / 2; 
                }
                source.start(this.nextStartTime);
                this.nextStartTime += audioBuffer.duration;
            }
            },
            onerror: (e: ErrorEvent) => {
            console.log('Error occurred: %s\n', JSON.stringify(e));
            this.connectionError = true; this.stopAudio();
            this.toastMessage.show('Connection error, please restart audio.');
            },
            onclose: (e: CloseEvent) => {
            console.log('Connection closed.');
            this.connectionError = true; this.stopAudio();
            this.toastMessage.show('Connection closed, please restart audio.');
            },
        },
        });
    } catch (err) {
        console.error("Failed to connect to session:", err);
        this.toastMessage.show("Failed to initialize music session. Check API Key and connection.");
        this.connectionError = true;
    }
  }

  private setSessionWeightedPrompts = throttle(async () => { 
    const promptsToSend: WeightedPrompt[] = Array.from(this.tracks.values()).filter((track) => {
      return !this.filteredTrackTexts.has(track.text) && track.weight > 0 && track.text.trim() !== '';
    }).map(track => ({
        // Using a clear distinction for the API, e.g., "Instrument Name: Prompt details"
        text: `${track.name}: ${track.text}`, 
        weight: track.weight
    }));

    try {
      if (this.session) { // Ensure session exists
        await this.session.setWeightedPrompts({ weightedPrompts: promptsToSend });
      }
    } catch (e: any) {
      this.toastMessage.show(e.message || 'Error setting prompts');
      this.pauseAudio();
    }
  }, 200);

  private dispatchTracksChange() { 
    this.dispatchEvent(new CustomEvent('tracks-changed', {detail: this.tracks}));
  }

  private handleTrackChanged(e: CustomEvent<Track>) { 
    const changedTrack = e.detail;
    const track = this.tracks.get(changedTrack.trackId);
    if (!track) return;

    const oldText = track.text;
    track.name = changedTrack.name;
    track.text = changedTrack.text;
    track.weight = changedTrack.weight;

    if (this.filteredTrackTexts.has(oldText) && oldText !== changedTrack.text) {
        this.filteredTrackTexts.delete(oldText);
    }
    const newTracks = new Map(this.tracks); // Create new map to trigger updates
    newTracks.set(changedTrack.trackId, track);
    this.tracks = newTracks;
    this.setSessionWeightedPrompts();
    this.dispatchTracksChange();
    this.requestUpdate('tracks'); // Explicitly request update for background
  }

  private makeBackground() {
    // Simplified background: subtle gradient based on average color or a fixed cool gradient
    // The previous complex per-track radial gradient might be too busy with the new UI.
    const activeTracks = [...this.tracks.values()].filter(t => t.weight > 0);
    if (activeTracks.length === 0) {
        return 'linear-gradient(135deg, #232526 0%, #414345 100%)'; // Default dark gradient
    }
    // Simple average color blending for a subtle effect
    let r = 0, g = 0, b = 0;
    activeTracks.forEach(track => {
        const color = track.color.startsWith('#') ? track.color.substring(1) : track.color;
        r += parseInt(color.substring(0, 2), 16) * track.weight;
        g += parseInt(color.substring(2, 4), 16) * track.weight;
        b += parseInt(color.substring(4, 6), 16) * track.weight;
    });
    const totalWeight = activeTracks.reduce((sum, t) => sum + t.weight, 0) || 1;
    r = Math.round(r / totalWeight);
    g = Math.round(g / totalWeight);
    b = Math.round(b / totalWeight);
    const avgColor = `rgba(${r},${g},${b},0.3)`; // Low opacity average color
    return `linear-gradient(135deg, ${avgColor} 0%, #1C1C1E 70%)`;
  }

  // --- Playback Methods (handlePlayPause, pauseAudio, loadAudio, stopAudio) ---
  // These remain largely the same.
  private async handlePlayPause() {
    if (this.playbackState === 'playing') this.pauseAudio();
    else if (this.playbackState === 'paused' || this.playbackState === 'stopped') {
      if (this.connectionError) {
        try {
            await this.connectToSession();
            if (!this.session) throw new Error("Session not initialized after connect");
            await this.setSessionWeightedPrompts();
            if (!this.connectionError) this.loadAudio();
        } catch(e: any) { this.toastMessage.show(e.message || 'Failed to reconnect. Please try again.'); return; }
      } else this.loadAudio();
    } else if (this.playbackState === 'loading') this.stopAudio(); 
  }
  private pauseAudio() {
    this.session?.pause(); this.playbackState = 'paused';
    if (this.audioContext.state === 'running') {
        this.outputNode.gain.setValueAtTime(this.outputNode.gain.value, this.audioContext.currentTime);
        this.outputNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.1);
    }
    this.nextStartTime = 0;
    this.outputNode = this.audioContext.createGain(); // Reset node to clear buffer
    this.outputNode.connect(this.audioContext.destination);
  }
  private loadAudio() {
    if (this.audioContext.state === 'suspended') this.audioContext.resume();
    this.session?.play(); this.playbackState = 'loading';
    this.outputNode.gain.setValueAtTime(0, this.audioContext.currentTime); 
    this.outputNode.gain.linearRampToValueAtTime(1, this.audioContext.currentTime + 0.2);
  }
  private stopAudio() {
    this.session?.stop(); this.playbackState = 'stopped';
     if (this.audioContext.state === 'running') {
        this.outputNode.gain.setValueAtTime(this.outputNode.gain.value, this.audioContext.currentTime);
        this.outputNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.1);
    }
    this.nextStartTime = 0;
  }

  // --- Track Management (handleAddTrack, handleTrackRemoved) ---
  private async handleAddTrackFromInput() { 
    const trackNameOrPrompt = this.newTrackInput.value.trim();
    if (trackNameOrPrompt === '') {
      this.toastMessage.show('Please enter a name or prompt for the new track.');
      return;
    }

    const newTrackId = `track-${this.nextTrackId++}`;
    const usedColors = [...this.tracks.values()].map((t) => t.color);
    
    // Simple heuristic: if it's short, assume it's a name. Otherwise, a prompt.
    let name = `Track ${this.nextTrackId}`;
    let text = 'Describe this musical part...';
    if (trackNameOrPrompt.length <= 20 && !trackNameOrPrompt.includes(' ')) { // Arbitrary length for name
        name = trackNameOrPrompt;
    } else {
        text = trackNameOrPrompt; // Use as initial prompt
    }

    const newTrack: Track = {
      trackId: newTrackId,
      name: name, 
      text: text, 
      weight: 0.5, // Default new tracks to a moderate weight
      color: getUnusedRandomColor(usedColors),
    };
    const newTracks = new Map(this.tracks);
    newTracks.set(newTrackId, newTrack);
    this.tracks = newTracks;

    this.newTrackInput.value = ''; // Clear input
    await this.setSessionWeightedPrompts(); 
    this.dispatchTracksChange(); 
    this.requestUpdate('tracks');
  }
  private handleSuggestionClicked(e: CustomEvent<string>) {
    this.newTrackInput.value = e.detail;
    this.newTrackInput.focus();
  }

  private handleTrackRemoved(e: CustomEvent<string>) { 
    e.stopPropagation();
    const trackIdToRemove = e.detail;
    if (this.tracks.has(trackIdToRemove)) {
      const track = this.tracks.get(trackIdToRemove);
      if (track && this.filteredTrackTexts.has(track.text)) {
          this.filteredTrackTexts.delete(track.text);
      }
      const newTracks = new Map(this.tracks); 
      newTracks.delete(trackIdToRemove);
      this.tracks = newTracks;
      this.setSessionWeightedPrompts();
      this.dispatchTracksChange();
      this.requestUpdate('tracks'); 
    }
  }
  
  private updateSettings = throttle(async (e: CustomEvent<LiveMusicGenerationConfig>) => {
      if (this.session) {
        await this.session.setMusicGenerationConfig({musicGenerationConfig: e.detail});
      }
    }, 200);

  private async handleReset() {
    if (this.connectionError) {
       try {
            await this.connectToSession();
            if (!this.session) throw new Error("Session not initialized after connect");
        } catch(e: any) { this.toastMessage.show(e.message || 'Failed to reconnect for reset.'); return; }
    }
    this.pauseAudio(); 
    this.session?.resetContext();
    this.settingsController.resetToDefaults(); 
    
    if (this.playbackState !== 'stopped' && this.playbackState !== 'paused' && !this.connectionError) {
        setTimeout(() => this.loadAudio(), 200); 
    } else if (this.connectionError && this.playbackState !== 'stopped' && this.playbackState !== 'paused'){
        this.playbackState = 'paused'; 
    }
  }

  // --- Render Method ---
  override render() {
    const bgStyles = styleMap({ backgroundImage: this.makeBackground() });
    return html`
      <div id="background" style=${bgStyles}></div>
      <div class="main-content" @track-removed=${this.handleTrackRemoved}>
        <div id="tracks-container">
          ${this.renderTracks()}
        </div>
        <div class="add-track-section">
          <input type="text" id="new-track-input" placeholder="Add a track (e.g., 'Lo-fi Beat' or 'Synth Lead name')" />
          <button id="add-track-icon-button" @click=${this.handleAddTrackFromInput} aria-label="Add new track">
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          </button>
        </div>
        <div class="suggestion-chips-container" @chip-clicked=${this.handleSuggestionClicked}>
            ${this.suggestionPrompts.map(prompt => html`<suggestion-chip .label=${prompt}></suggestion-chip>`)}
        </div>
      </div>
      <div id="bottom-controls-panel">
        <div class="settings-controller-wrapper">
            <settings-controller @settings-changed=${this.updateSettings}></settings-controller>
        </div>
        <div class="playback-controls-wrapper">
          <play-pause-button @click=${this.handlePlayPause} .playbackState=${this.playbackState}></play-pause-button>
          <reset-button @click=${this.handleReset}></reset-button>
        </div>
      </div>
      <toast-message></toast-message>
    `;
  }

  private renderTracks() { 
    return [...this.tracks.values()].map((track) => {
      return html`<track-controller
        .trackId=${track.trackId}
        .name=${track.name}
        .text=${track.text}
        .weight=${track.weight}
        .color=${track.color}
        .filtered=${this.filteredTrackTexts.has(track.text)}
        @track-changed=${this.handleTrackChanged}>
      </track-controller>`;
    });
  }
}

// --- Main Initialization and Local Storage ---
function main(container: HTMLElement) {
  const initialTracks = getStoredTracks(); 
  const pdj = new PromptDj(initialTracks);
  pdj.addEventListener('tracks-changed', (e: Event) => {
    const customEvent = e as CustomEvent<Map<string, Track>>;
    setStoredTracks(customEvent.detail); 
  });
  container.appendChild(pdj);
}

function getStoredTracks(): Map<string, Track> { 
  const {localStorage} = window;
  const storedTracksJson = localStorage.getItem('tracks'); 
  if (storedTracksJson) {
    try {
      const parsedTracks = JSON.parse(storedTracksJson) as Track[];
      return new Map(parsedTracks.map((track) => [track.trackId, track]));
    } catch (e) { console.error('Failed to parse stored tracks', e); }
  }
  // Default tracks if none stored
  const defaultTrackNames = ["Drums", "Bassline", "Harmony", "Melody"];
  const defaultTracksArray: Track[] = [];
  const usedColors: string[] = [];
  defaultTrackNames.forEach((name, i) => {
    const color = getUnusedRandomColor(usedColors); usedColors.push(color);
    let weight = 0;
    if (name === "Drums" || name === "Bassline") weight = 1.0;
    else if (name === "Harmony") weight = 0.5;
    defaultTracksArray.push({
      trackId: `track-${i}`, name: name,
      text: INITIAL_TRACK_DESCRIPTIONS[name] || `Describe ${name.toLowerCase()}...`,
      weight: weight, color: color,
    });
  });
  return new Map(defaultTracksArray.map((t) => [t.trackId, t]));
}

function setStoredTracks(tracks: Map<string, Track>) { 
  const storedTracksJson = JSON.stringify([...tracks.values()]);
  localStorage.setItem('tracks', storedTracksJson); 
}

main(document.body);

declare global {
  interface HTMLElementTagNameMap {
    'prompt-dj': PromptDj;
    'track-controller': TrackController; 
    'settings-controller': SettingsController;
    // 'add-prompt-button': AddTrackButton; // No longer used as a dedicated component
    'play-pause-button': PlayPauseButton;
    'reset-button': ResetButton;
    // 'weight-slider': WeightSlider; // Replaced by horizontal-weight-control
    'horizontal-weight-control': HorizontalWeightControl;
    'suggestion-chip': SuggestionChip;
    'toast-message': ToastMessage;
  }
}