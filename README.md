# Age of War Multiplayer - Refactored

This project is a real-time multiplayer strategy game inspired by "Age of War". It supports both online multiplayer (via Firebase) and an offline mode for testing/local play.

## Project Structure

- `index.html`: Main entry point for Online Multiplayer.
- `offline.html`: Entry point for Offline Mode (bots only, no internet required).
- `css/`: Styling files.
- `js/`: Source code.
  - `common/`: Shared constants and utilities.
  - `engine/`: Game logic and rendering.
  - `network/`: Adapters for Firebase and Offline modes.
  - `ui/`: UI management.

## Deployment Guide (GitHub Pages)

To host this game on GitHub Pages:

1. **Create a GitHub Repository**:
   - Go to GitHub and create a new repository (e.g., `age-of-ffa`).
   - Do not initialize with README if you are pushing this existing folder.

2. **Push Code**:
   - Open a terminal in this project folder.
   - Run:
     ```bash
     git init
     git add .
     git commit -m "Initial commit"
     git branch -M main
     git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
     git push -u origin main
     ```

3. **Enable GitHub Pages**:
   - Go to your repository on GitHub.
   - Go to **Settings** > **Pages**.
   - Under **Source**, select `main` branch and `/ (root)` folder.
   - Click **Save**.

4. **Play**:
   - Your game will be available at `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`.
   - Use `index.html` for online play and `offline.html` for offline play.

## Firebase Setup (For Online Mode)

The game is currently configured with a public Firebase config. If you want to host your own backend:
1. Create a project at [firebase.google.com](https://firebase.google.com).
2. Enable **Firestore Database** and **Authentication** (Anonymous).
3. Update `js/network/firebase-adapter.js` with your own project configuration keys.

