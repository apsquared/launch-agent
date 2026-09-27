## What and why

<!-- One change per pull request. For a playbook change: when you saw the flow, and a source if there is one. -->

## Checklist

- [ ] `npm test` passes
- [ ] Nothing about one product: no product names, URLs, listing IDs, copy or chosen categories in `src/`, `platforms/`, `prompts/`, skills, examples or tests
- [ ] Doesn't loosen `policy.yaml`, `src/guards.ts`, the MCP server's checks, or the agent lockdown (`src/agents/`, `launch-watched`), or explains why below and adds a test
- [ ] If `prompts/submit.md` or `src/watched-agent.ts` changed: ran `npm run watch:agent`
- [ ] Docs (README, CONTRIBUTING, skills) updated if behaviour changed
