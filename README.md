<p align="center">
  <img src="icons/icon128.png" alt="Project Banner">
</p>

<h1 align="center">Gemini Page Translator Pro</h1>

<p align="center">
  <a href="https://github.com/your-username/your-repo/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/medy17/GeminiTranslate" alt="License">
  </a>
  <a href="https://developer.chrome.com/docs/extensions/mv3/">
    <img src="https://img.shields.io/badge/Manifest-V3-brightgreen.svg" alt="Manifest V3">
  </a>
   <a href="https://chromewebstore.google.com/">
    <img src="https://img.shields.io/badge/Chrome%20Web%20Store-v2.2-blue.svg" alt="Chrome Web Store">
  </a>
</p>

<p align="center">
  <strong>A powerful Chrome extension to translate web pages using a selection of powerful AI models, including Google's Gemini family and xAI's Grok.</strong>
</p>

---

## Table of Contents

- [About The Project](#-about-the-project)
    - [Key Features](#-key-features)
    - [Screenshots](#-screenshots)
- [ Tech Stack](#️-tech-stack)
- [ Architectural Decisions](#-architectural-decisions)
- [ Getting Started](#-getting-started)
    - [Prerequisites](#prerequisites)
    - [Installation](#installation)
- [ Roadmap](#️-roadmap)
- [ License](#-license)
- [ Contact](#-contact)

---

##  About The Project

**Gemini Page Translator Pro** is a modern Chrome extension built with Manifest V3 that harnesses the power of leading AI models from Google (Gemini) and xAI (Grok) to provide high-quality, context-aware translation of web pages.

Unlike traditional translation services, this extension leverages advanced generative AI to understand and translate text, preserving nuance and context. The inclusion of Grok also provides a powerful option for users who may need to translate content without the strict safety filters often found in other models. It features a user-friendly dark-mode interface for configuring your API keys, preferred models, and languages. With support for both full-page and on-demand selection translation, it offers a flexible and powerful tool for anyone browsing the multilingual web.

###  Key Features

*   **Multi-Model AI Translation:** Choose the best AI for the job! The extension supports:
    *   **Google Models:** The full Gemini family (2.5 Pro, 2.5 Flash) and the latest Gemma models for high-quality, nuanced translations.
    *   **xAI Models:** The Grok family (Grok 4, Grok 4 Fast) for fast, capable translation, including NSFW content which often leads to failed translations when using Gemini models..
*   **Full Page Translation:** Translate an entire webpage with a single click from the extension popup.
*   **Context Menu Integration:** Simply select text, right-click, and translate it instantly in-place.
*   **Interactive Translations:** Translated text can be clicked to toggle back to the original version, with a helpful tooltip showing the alternative.
*   **Auto-Translation:** Configure a list of websites to be translated automatically every time you visit them.
*   **Efficient & Smart:** Features in-session caching to avoid re-translating text and a robust API queueing system to manage requests gracefully and prevent rate-limiting errors.
*   **Modern & Secure:** Built on Manifest V3, ensuring better performance, privacy, and security.

###  Screenshots

|               Main Interface                |
|:---------------------------------------------------:| 
| <img height="300" src="readme-assets/popup.png"/> |
---

##  Tech Stack

A list of the major technologies used in the project.

*   [HTML5](https://en.wikipedia.org/wiki/HTML5)
*   [CSS3](https://en.wikipedia.org/wiki/CSS)
*   [Vanilla JavaScript](http://vanilla-js.com/)
*   [Chrome Extension API (Manifest V3)](https://developer.chrome.com/docs/extensions/mv3/)
*   [Google Gemini API](https://ai.google.dev/docs/gemini_api_overview)
*   [xAI Grok API](https://x.ai/api)

---

##  Architectural Decisions

I chose a **Manifest V3 architecture with a Service Worker** for the background logic. This aligns with modern Chrome extension standards, providing improved security and performance by moving processes off the main thread.

For DOM manipulation, the content script uses `document.createTreeWalker`. This is a highly efficient method for traversing the DOM and collecting only `TEXT_NODE` elements, ensuring that scripts, styles, and other non-textual elements are ignored. This prevents page breakage and isolates the translation logic to relevant content.

To manage API interactions, I implemented a **request queue with concurrency limiting**. All translation requests are added to a queue, which is processed in batches. This prevents overwhelming the backend API with too many simultaneous requests, gracefully handling rate limits and ensuring stability, especially on text-heavy pages. An in-memory `Map` serves as a session cache to prevent redundant API calls for the same text, saving API costs and speeding up re-translations.

Finally, translations are **non-destructive**. The original text is stored in a `data-original-text` attribute on a `<span>` that wraps the translated content. This makes reverting translations trivial and instantaneous, without requiring a page reload or complex state management.

---

##  Getting Started

To get a local copy up and running, follow these simple steps.

### Prerequisites

*   A Chromium-based web browser (e.g., Google Chrome, Microsoft Edge, Brave).
*   An API key for the model you wish to use:
    *   **Google Gemini API Key**: Obtain one from [Google AI Studio](https://aistudio.google.com/u/0/api-keys/).
    *   **xAI Grok API Key**: Obtain one from your [xAI account dashboard](https://x.ai/api).

### Installation

1.  Clone the repository or download it as a ZIP file and unzip it.
    ```bash
    git clone https://github.com/medy17/GeminiTranslate.git
    ```
2.  Open your Chromium-based browser and navigate to the extensions page. For Chrome, this is `chrome://extensions`.
3.  Enable **"Developer mode"** using the toggle switch, usually found in the top-right corner.
4.  Click the **"Load unpacked"** button that appears.
5.  In the file selection dialog, navigate to and select the cloned project folder (the one containing `manifest.json`).
6.  The extension should now appear in your extensions list! Pin it to your toolbar for easy access.
7.  Click the extension icon to open the popup, paste your Gemini and/or Grok API key(s) into the designated field(s), select your preferred model and languages, and click **"Save All Settings"**. You are now ready to translate!

---

##  Roadmap

See the [open issues](https://github.com/your-username/your-repo/issues) for a list of proposed features (and known issues).

- [x] Full Page Translation
- [x] Context Menu Selection Translation
- [x] Support for Multiple AI Providers (Google Gemini & xAI Grok)
- [ ] Add option to exclude specific HTML elements (e.g., `<code>`, `<pre>`) from translation.
- [ ] Implement a more persistent caching mechanism using `chrome.storage.local`.
- [ ] Add more language options to the dropdown menus.
- [ ] Create a UI to view and manage auto-translate site list and cache.

##  License

Distributed under the MIT License. See `LICENSE` for more information.

---

##  Contact

Ahmed Arat - [aratahmed@gmail.com](mailto:aratahmed@gmail.com)

Project Link: [https://github.com/medy17/GeminiTranslate](https://github.com/medy17/GeminiTranslate)