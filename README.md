# LifeOps Daily Planner

LifeOps Daily Planner is a personal operations agent that helps users organize their day, prioritize tasks, manage calendar commitments, break projects into manageable steps, and produce realistic plans based on available time and energy.

## Architecture

This project is built using a modular architecture with Node.js and Express to enable a clean separation of concerns and future extensibility.

- `src/agent`: Contains the core agent reasoning, prompts, and orchestration (`planner_agent.js`).
- `src/tools`: Adapters for external services (Calendar, Tasks, Email, Time). Currently using mock implementations for easy setup and testing.
- `src/models`: Data structures and schemas defining `Task`, `CalendarEvent`, and `DailyPlanBlock`.
- `src/ui`: A vanilla HTML/CSS/JS frontend providing the user interface, Focus Mode, and Chat Panel.
- `src/server.js`: The API and static file server.

This design ensures the `PlannerAgent` can be integrated as a specialized sub-agent inside a larger multi-agent system (LifeOps Orchestrator) in the future.

## Prerequisites

- Node.js (v18 or higher recommended)
- npm

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the environment variables example file:
   ```bash
   cp .env.example .env
   ```
   *(Note: The current version does not strictly require keys as it uses mock adapters, but the file is required for setup).*

## Running Locally

To start the local development server:

```bash
node src/server.js
```

The application will be accessible at [http://localhost:3000](http://localhost:3000).

## Testing

The project uses Node.js native test runner. To run the automated test suite, which covers scheduling edge cases, overlapping events, and replanning functionality:

```bash
node --test tests/*.test.js
```

## Deployment

The application is a standard Node.js Express app and can be easily deployed to platforms like Render, Heroku, or Vercel (using custom output configuration).

1. Ensure the `PORT` environment variable is mapped properly in your hosting provider's configuration.
2. Define the start script in `package.json` (already configured or use `node src/server.js`).
3. Deploy the repository.

### Future Integrations
The tools in `src/tools/` are currently built with mock data stores. To connect to a live backend (e.g., Google Calendar, Todoist, Gmail), update the tool files to use the respective API clients while adhering to the established interface contracts.
