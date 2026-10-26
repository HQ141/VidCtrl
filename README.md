# VidCtrl — Unified Video Control

A browser extension that gives every video on the web the same speed and volume controls: YouTube, Twitch, course sites, news embeds, anything that plays an HTML5 `<video>` or `<audio>`.

Set a speed once and every tab follows it. Volume stays separate for each tab, and can go above 100% where the browser allows it.

## Features

- **One speed everywhere.** Changing the speed in one tab changes it in every open tab, and new videos start at that speed.
- **Keeps your speed.** Many sites reset to 1× on the next video, after an ad or on a quality switch. VidCtrl sets your speed again.
- **Volume per tab, with boost.** Turn a quiet video up past 100% (up to 300% by default).
- **Keyboard shortcuts** that work the same on every site.
- **Works with embedded players.** It finds videos inside iframes and custom player components, and picks the one you're actually watching.
- **On-screen indicator** showing the new speed or volume when it changes, including in fullscreen.
- **Popup** with sliders, speed presets (1×, 1.25×, 1.5×, 2×, 3×) and a mute button.
- Works in **Chrome, Edge, Brave and other Chromium browsers**, and **Firefox 128+**.

## Install (from source)

The extension isn't on the Chrome Web Store or Firefox Add-ons yet, so you load it from this folder.

### Chrome / Edge / Brave

1. Download or clone this repository.
2. Open `chrome://extensions` (`edge://extensions` in Edge, `brave://extensions` in Brave).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose the `VidCtrl` folder.

Chromium shows warnings about `background.scripts` and `browser_specific_settings`. Those entries are for Firefox; Chromium ignores them and the extension works normally.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `manifest.json` in this folder.

Temporary add-ons are removed when Firefox closes. If the extension does nothing on a page, open `about:addons` → VidCtrl → **Permissions** and allow access to all websites.

## Usage

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> | Faster |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>,</kbd> | Slower |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>↑</kbd> | Volume up |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>↓</kbd> | Volume down |
| *not set* | Reset speed to 1× |
| *not set* | Mute / unmute |

Browsers allow an extension only four default shortcuts, so reset and mute start without one. To set them, or to change any shortcut, open **Shortcuts** from the popup, or go to:

- Chrome / Edge: `chrome://extensions/shortcuts` (`edge://extensions/shortcuts`)
- Firefox: `about:addons` → gear icon → **Manage Extension Shortcuts**

### Popup

Click the toolbar icon to see and change the current video's speed and volume. While a speed other than 1× is active, the toolbar icon shows it (for example `1.5`).

### Settings

Open **Settings** from the popup.

| Setting | Default | What it does |
|---|---|---|
| Speed step | 0.25 | How much each shortcut press changes the speed |
| Keep my speed when the site resets it | On | Sets your speed again when a site switches back to 1× |
| Volume step | 10% | How much each shortcut press changes the volume |
| Allow boosting above 100% | On | Lets volume go past the browser's normal maximum |
| Maximum boost | 300% | The highest boost allowed |
| Show speed and volume on the video | On | Shows the on-screen indicator |

## How it works

- `content.js` runs in every page and frame. When a command comes in, it scores the media elements in that frame: playing beats paused, the one you last played gets a bonus, and bigger visible videos rank higher. It then acts on the best one.
- `background.js` receives shortcut and popup commands. It asks every frame in the tab for its best score and sends the command only to the frame that wins. That way a page with several embedded players changes just one of them.
- The shared speed is stored in `storage.local`. Every tab listens for changes to it, which is how one speed change reaches all tabs.
- Volume above 100% routes the video's audio through the Web Audio API with a gain node.

## Limitations

- **No volume boost on DRM-protected video** (Netflix, Disney+, Prime Video and similar). The browser doesn't let extensions process that audio. Speed control still works there.
- **No volume boost on some cross-origin videos.** This applies when a video file comes from another domain without CORS headers, because routing it through Web Audio would make it silent. VidCtrl detects this, keeps the volume at 100% and says boost isn't available.
- **Boost needs one click on the page first.** Browsers block audio processing until you've interacted with the page. If boost asks for a click, click anywhere on the page and try again.
- **Some live streams don't allow speed changes.**
- **Browser pages can't be controlled.** That includes `chrome://` pages, the extension stores and the built-in PDF viewer.
- **The speed persists across browser restarts.** Press 1× in the popup to go back to normal everywhere.

## Permissions

| Permission | Why |
|---|---|
| Access to all websites (`<all_urls>`) | Videos can be on any site, so the controls have to run on any site |
| `scripting` | Lets the extension find the right frame and start working in tabs that were already open when it was installed |
| `storage` | Saves your settings and the shared speed |

VidCtrl doesn't collect, send or log any data. Everything stays in your browser.

## Project structure

```
manifest.json    Extension manifest (Manifest V3, Chromium + Firefox)
background.js    Routes shortcuts and popup actions to the right tab and frame; updates the badge
content.js       Finds videos and applies speed, volume, boost and the on-screen indicator
content.css      On-screen indicator styles
defaults.js      Default settings shared by content.js and the settings page
popup.html/.css/.js     Toolbar popup
options.html/.js        Settings page
icons/           Toolbar and store icons (16, 32, 48, 128 px)
```

There's no build step: edit the files, then reload the extension from the extensions page.
