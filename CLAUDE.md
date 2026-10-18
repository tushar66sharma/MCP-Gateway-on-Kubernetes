# Mandatory Project-Wide Instructions for Claude Code

These instructions are mandatory and must be followed throughout the entire project lifecycle, including planning, architecture, implementation, testing, debugging, refactoring, and deployment. Treat them as persistent project requirements, not optional suggestions.

## 1. Continuous Documentation of Every Step and Decision

- Document every significant implementation step, architectural decision, design choice, technology selection, trade-off, and change made during development.
- Maintain a single, centralized project documentation directory named `docs/`.
- Record **what was decided, why it was decided, how it was implemented, what alternatives were considered, and what trade-offs were accepted**.
- Update the documentation yourself as you work. Do not wait for me to request documentation or postpone it until the end of the project.
- Whenever a decision changes, update the relevant documentation and explain why the previous approach was replaced.
- Document important assumptions, constraints, dependencies, and unresolved issues.
- Keep the documentation synchronized with the actual codebase. Never leave documentation describing outdated or unimplemented behavior.
- Organize documentation clearly so that I can study the project later and understand the reasoning behind every major decision.

## 2. Free AI API Providers and Pluggable Model Architecture

- Design the AI integration layer to work with **AI platforms that offer free API access to free-tier models**.
- Do not use the Gemini API or Gemini API keys anywhere in the project.
- Before selecting a provider, verify its current free-tier availability, supported models, API limits, rate limits, and usage restrictions using official documentation.
- Do not assume that a free API key means unlimited usage or permanent free access. Document any quotas, expiration conditions, credit limits, and restrictions.
- Implement a provider-independent AI integration layer so that switching from one AI provider to another requires changing configuration, API credentials, or a provider adapter rather than rewriting the application's business logic.
- Prefer OpenAI-compatible APIs where supported, but do not assume every provider is fully compatible.
- Keep provider-specific logic isolated behind a common interface or adapter.
- Store API keys and secrets in environment variables or the deployment platform's secret manager. Never hardcode credentials, commit secrets, or expose server-side keys in frontend code.
- Provide a clear `.env.example` containing placeholder values and explanations, without real credentials.
- Make the active AI provider, model, endpoint, and other necessary settings configurable.
- Implement appropriate timeouts, retries with backoff, rate-limit handling, error normalization, and fallback behavior where feasible.
- Ensure that switching providers does not silently change the application's expected output format or break existing workflows.
- Document how to obtain a free API key, configure each supported provider, switch providers, and troubleshoot common API errors.

**Acceptance criterion:** I must be able to switch between supported AI providers by updating configuration and, only when necessary, implementing a small isolated adapter. The rest of the application must continue working without provider-specific changes.

## 3. Professional, Enterprise-Quality and Responsive Frontend

- Build a complete, functional frontend that allows users to interact with all required project features.
- The interface must look like a polished enterprise-grade software product, not a basic prototype or an unstyled demonstration.
- Establish a consistent design system covering colors, typography, spacing, layouts, buttons, forms, tables, navigation, dialogs, and reusable components.
- Ensure the interface is responsive across desktop, laptop, tablet, and mobile screen sizes.
- Include appropriate loading states, empty states, success messages, validation feedback, error states, and confirmation dialogs.
- Provide clear navigation and intuitive workflows so that users can understand how to use the application without technical knowledge.
- Follow accessibility best practices, including semantic HTML, keyboard navigation, visible focus indicators, sufficient color contrast, and accessible form labels.
- Ensure the frontend is connected to real backend functionality. Do not leave placeholder buttons, fake data, or nonfunctional workflows unless explicitly identified as mock functionality.
- Handle API failures gracefully and prevent users from being left with blank screens or unclear error messages.
- Optimize frontend performance, component reusability, maintainability, and consistency.
- Verify the important user journeys at desktop and mobile breakpoints before declaring the frontend complete.

## 4. Comprehensive Technical Documentation and System Design

Maintain detailed documentation inside `docs/` covering the complete system architecture, workflows, implementation, and operational behavior.

At a minimum, include the following documents, adapting the structure to the actual project:

- `docs/architecture.md` — High-level architecture, components, responsibilities, and technology choices.
- `docs/system-design.md` — Detailed system design, component interactions, data flow, interfaces, dependencies, and design trade-offs.
- `docs/workflows.md` — Step-by-step explanation of the application's major workflows.
- `docs/diagrams/` — Architecture diagrams, sequence diagrams, data-flow diagrams, and workflow diagrams.
- `docs/ai-integration.md` — AI provider abstraction, model selection, configuration, key setup, quotas, failures, and provider switching.
- `docs/error-handling.md` — Failure scenarios, error propagation, retries, timeouts, fallbacks, recovery, and user-facing error behavior.
- `docs/security.md` — Authentication, authorization, secret management, input validation, data protection, and relevant security controls.
- `docs/testing.md` — Testing strategy, test commands, test coverage, and verification procedures.
- `docs/decisions/` — Significant architecture and implementation decisions, including rationale and alternatives.
- `docs/troubleshooting.md` — Common development, configuration, API, testing, and deployment problems with their solutions.

### Diagram requirements

- Create clear diagrams for every major business workflow and important cross-component interaction.
- Use Mermaid diagrams in Markdown wherever practical so diagrams remain version-controlled and easy to edit.
- Include architecture diagrams, workflow flowcharts, sequence diagrams, and data-flow diagrams as appropriate.
- Explain each diagram in text, including the actors or components involved, the sequence of operations, and important decision points.
- Ensure diagrams reflect the actual implementation and are updated whenever the corresponding workflow changes.

### Failure and recovery documentation

For every important workflow, explain:

- What can fail and under what conditions.
- How errors are detected and propagated.
- Which failures are retried and which are not.
- How timeouts, rate limits, invalid inputs, and unavailable external services are handled.
- Whether fallback behavior is available and what its limitations are.
- How partial operations, duplicate requests, and inconsistent state are prevented or recovered from.
- What the user sees when an operation fails.
- What logs, metrics, or diagnostic information are available for debugging.

### Documentation quality

- Explain the project in sufficient depth that a developer unfamiliar with the codebase can understand its purpose, architecture, and major implementation choices.
- Document public APIs, important modules, configuration variables, database entities, and critical business rules.
- Explain how to run, test, debug, extend, and maintain the system.
- Include practical examples where they make a concept easier to understand.
- Keep the documentation accurate, organized, searchable, and consistent with the source code.

## 5. A Complete and Beginner-Friendly README

Create and continuously maintain a comprehensive `README.md` at the repository root.

The README must explain the project from the perspective of someone encountering it for the first time.

Include:

1. Project name and overview.
2. The problem being solved and the motivation behind the project.
3. Key features and user capabilities.
4. Main workflows and how the application works.
5. Screenshots or visual demonstrations when available.
6. System architecture and links to detailed design documents.
7. Architecture or workflow diagrams for the main user journeys.
8. Technology stack and the reason for choosing each major technology.
9. Repository structure with explanations of important directories and files.
10. Prerequisites and required software versions.
11. Complete local installation and setup instructions.
12. Environment-variable configuration, with explanations of each required variable.
13. Instructions for obtaining and configuring supported free-tier AI API keys.
14. Database setup, migrations, and initialization, if applicable.
15. Development commands for running the frontend, backend, and supporting services.
16. Testing commands and instructions for verifying that the installation works.
17. Build and production execution instructions.
18. Deployment instructions and links to more detailed deployment guides.
19. Security considerations and secret-management requirements.
20. Troubleshooting guidance for common errors.
21. Links to the documentation in `docs/`.
22. Known limitations, assumptions, and future improvements.

Write the README so a beginner can follow it sequentially without having to guess missing steps or search through the source code for essential setup information.

Never include real API keys, passwords, tokens, or other secrets in the README.

## 6. Free-Tier Deployment and Beginner-Friendly Deployment Guides

- Design the system to be deployable using suitable platforms that provide free-tier hosting, such as Vercel, Render, or other appropriate providers.
- Verify the current free-tier features, resource limits, sleep behavior, build limits, database restrictions, and pricing conditions using official platform documentation before recommending a deployment architecture.
- Do not assume that every service remains free indefinitely or that a free tier includes every required capability.
- Prefer an architecture that minimizes cost and operational complexity while meeting the project's functional and security requirements.
- Clearly identify any components that cannot realistically run within the available free tiers.
- Never silently introduce a paid service or dependency that is essential to the application's basic operation. Explain any unavoidable costs and alternatives.
- Create a dedicated deployment guide, such as `docs/deployment.md`, with separate instructions for each supported deployment option.
- Explain how to deploy the frontend, backend, database, background workers, and other required services, as applicable.
- Include account setup, project creation, repository connection, build commands, start commands, runtime versions, environment variables, database configuration, migrations, and domain or networking setup where required.
- Explain how to configure API keys securely through deployment settings rather than committing them to source control.
- Include instructions for handling CORS, callback URLs, health checks, logs, build failures, deployment failures, and service-to-service communication where relevant.
- Document platform-specific limitations, such as sleeping services, cold starts, ephemeral filesystems, execution timeouts, storage restrictions, and request limits.
- Explain how to verify that the deployed application is working, test its major workflows, inspect logs, and diagnose failures.
- Include rollback, redeployment, and basic maintenance instructions where the platform supports them.
- Write the deployment guide for a beginner who has never deployed a full-stack application before. Explain each step, its purpose, and the expected result.

**Acceptance criterion:** A beginner must be able to follow the deployment guide from start to finish and deploy the project without needing undocumented manual fixes.

## 7. Mandatory Workflow for All Future Development

Follow this process for every significant feature, refactor, bug fix, or infrastructure change:

1. Inspect the existing code and relevant documentation before making changes.
2. Understand the requirement, existing architecture, constraints, and dependencies.
3. Identify the affected components and consider edge cases and failure scenarios.
4. Choose an implementation approach and document significant decisions and alternatives.
5. Implement the change using modular, maintainable, secure, and testable code.
6. Add or update appropriate automated tests.
7. Run the relevant tests, linters, type checks, builds, and security checks available in the project.
8. Fix failures introduced by the change and investigate unexpected regressions.
9. Update the README and relevant technical documentation, diagrams, configuration examples, and troubleshooting guidance.
10. Review the final changes for correctness, security, maintainability, and consistency.
11. Summarize what changed, why it changed, which files were affected, what checks were run, and any remaining limitations.

Do not claim a feature, test, deployment, or workflow is complete unless it has been implemented and verified to the extent possible in the current environment. Clearly distinguish successful verification from assumptions or checks that could not be performed.

## 8. General Engineering Standards

- Prioritize correctness, security, maintainability, reliability, and clear architecture over unnecessary complexity.
- Follow separation of concerns, modular design, single responsibility, dependency inversion where appropriate, and other relevant software engineering principles.
- Validate inputs at system boundaries and enforce authorization on the backend where applicable.
- Avoid unnecessary duplication, oversized modules, tightly coupled components, and undocumented magic values.
- Use consistent naming, formatting, error-handling conventions, and project structure.
- Add comments and explanations where they clarify non-obvious decisions or complex logic, rather than commenting every line.
- Never commit secrets, generated credentials, local environment files containing secrets, or sensitive production data.
- Keep dependencies necessary and maintainable, and explain important dependency choices.
- Do not silently remove existing functionality, change established contracts, or introduce breaking changes.
- Do not overwrite user work or perform destructive operations without first understanding their impact.
- If a requirement is ambiguous, identify the ambiguity and ask for clarification when it materially affects architecture, cost, security, or behavior.
- If a requirement cannot be fulfilled as written, explain the limitation and propose the closest safe, practical alternative.
- Before marking any milestone complete, verify the implementation and update all relevant documentation.

## 9. Final Definition of Done

A feature or project milestone is complete only when all applicable conditions below are met:

- The required functionality is implemented.
- The frontend and backend work together correctly.
- Relevant edge cases and failure scenarios are handled.
- Appropriate tests have been added and executed.
- No known critical regressions have been introduced.
- Security-sensitive configuration is handled safely.
- Relevant architecture, workflow, and decision documentation is updated.
- Required diagrams accurately represent the implementation.
- The README and setup instructions remain correct.
- Deployment instructions reflect the actual application and verified platform behavior.
- Remaining issues, limitations, or unverified assumptions are explicitly documented.

**Final rule:** Treat documentation, tests, security, provider independence, professional UI quality, and beginner-friendly deployment as core deliverables throughout development—not as optional tasks to complete after the code is finished.