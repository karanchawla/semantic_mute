# Contributing to Semantic Mute

Thank you for your interest in contributing to Semantic Mute! This document provides guidelines and instructions for contributing.

## Code of Conduct

- Be respectful and inclusive
- Keep discussions focused and constructive
- No harassment or discriminatory behavior
- Help others learn and grow

## How to Contribute

### Reporting Bugs
1. Check if the bug has already been reported in [Issues](https://github.com/karanchawla/semantic_mute/issues)
2. If not, create a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - Browser version and OS
   - Screenshots if applicable

### Suggesting Enhancements
1. Open a new issue labeled 'enhancement'
2. Describe the feature and its benefits
3. Include any relevant examples or mockups
4. Discuss implementation approaches if possible

### Pull Requests
1. Fork the repository
2. Create a new branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Test thoroughly
5. Commit with clear messages: `feat: add new feature x`
6. Push to your fork
7. Create a Pull Request

## Development Setup

1. Clone your fork:
```bash
git clone https://github.com/YOUR_USERNAME/semantic_mute.git
cd semantic_mute
```

2. Load in Chrome:
- Open `chrome://extensions`
- Enable Developer Mode
- Click "Load unpacked"
- Select the extension directory

3. Make changes and reload extension to test

## Coding Guidelines

### JavaScript
- Use ES6+ features
- Follow existing code style
- Add comments for complex logic
- Keep functions focused and small
- Use meaningful variable names

### HTML/CSS
- Follow BEM naming convention
- Keep styles modular
- Maintain dark theme consistency
- Ensure accessibility

### Git Commits
Follow conventional commits:
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation
- `style:` Formatting
- `refactor:` Code restructuring
- `test:` Adding tests
- `chore:` Maintenance

### Testing
- Test on both Twitter and X domains
- Test with different mute rules
- Test error scenarios
- Test memory management
- Verify API key encryption

## Documentation

- Update README.md for new features
- Add JSDoc comments for functions
- Update PRIVACY.md if data handling changes
- Keep inline comments clear and necessary

## Release Process

1. Version bumps follow semver:
   - MAJOR: Breaking changes
   - MINOR: New features
   - PATCH: Bug fixes

2. Update:
   - manifest.json version
   - CHANGELOG.md
   - README.md if needed

## Questions?

Open an issue labeled 'question' for any contribution-related queries.

Thank you for helping make Semantic Mute better! 🚀 