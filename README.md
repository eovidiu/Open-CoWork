# Open CoWork

A desktop AI coding assistant for everyone. Open source alternative to Claude Code, Cursor, and similar tools.

**If you find this project useful, please consider giving it a star!**

[![GitHub stars](https://img.shields.io/github/stars/Autonoma-Labs/Open-CoWork?style=social)](https://github.com/Autonoma-Labs/Open-CoWork)

---

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- [pnpm](https://pnpm.io/) package manager

### Quick Start

```bash
# Clone the repository
git clone https://github.com/Autonoma-Labs/Open-CoWork.git
cd open-cowork

# Install dependencies
pnpm install

# Run in development mode
pnpm dev
```

### Building from Source

#### macOS
```bash
pnpm build:mac
```
Output: `dist/Open CoWork-x.x.x.dmg`

#### Windows
```bash
pnpm build:win
```
Output: `dist/open-cowork-x.x.x-setup.exe`

#### Linux
```bash
pnpm build:linux
```
Output: `dist/open-cowork-x.x.x.AppImage`

---

## Help Wanted

We're actively looking for contributors to help with:

### Build & Distribution
- **Windows builds** - We need help testing and fixing Windows builds
- **macOS builds** - Help with code signing and notarization
- **Linux builds** - Testing on various distributions (Ubuntu, Fedora, Arch, etc.)

### Bug Hunting
- **Finding and reporting bugs** - Use the app and report any issues you encounter
- **Reproducing issues** - Help confirm bugs reported by others
- **Writing bug fixes** - Submit PRs for issues you can fix

### How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b fix/my-bug-fix`)
3. Commit your changes (`git commit -m 'Fix: description of fix'`)
4. Push to the branch (`git push origin fix/my-bug-fix`)
5. Open a Pull Request

Please report bugs at [GitHub Issues](https://github.com/Autonoma-Labs/Open-CoWork/issues).

---

## Features

- Chat-based AI assistant with tool execution
- File system access with permission controls
- Multi-conversation support with tabs
- Skills marketplace (integrated with skillregistry.io)
- Pre-installed skills for PDF, Word, Excel, and PowerPoint
- Dark/light/system theme support

---

## Tech Stack

- Electron + electron-vite
- React 18 + TypeScript
- Tailwind CSS + shadcn/ui
- Prisma + SQLite
- Vercel AI SDK

---

## License

[MIT](LICENSE) © 2026 Autonoma

---

**Like what you see? Star the repo to show your support!**

[![Star this repo](https://img.shields.io/github/stars/Autonoma-Labs/Open-CoWork?style=for-the-badge&logo=github)](https://github.com/Autonoma-Labs/Open-CoWork)
