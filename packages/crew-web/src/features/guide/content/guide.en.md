# Using 2P Crew

2P Crew is a team of AI agents that can write code. You describe what you want in plain words, for example "add an export-to-Excel button on the report page". The agents split the work, write the code, review it, update the documentation and push the code to the main branch. You only answer when asked and approve at the last step.

This guide is written for **first-time users** and needs no programming knowledge. Read it from the top: section 1 answers "do I have to set anything up", sections 2 to 8 cover daily use, and the later sections are for looking things up. Click a section name in the **Contents** below to jump to it.

## 1. First visit: is there anything to set up?

**No.** The company and the machines are already set up. You only do four things: **sign in, give a request to the Assistant, answer questions, approve the result.**

| Part | What it is |
|---|---|
| **Company** | The workspace that holds all requests, projects and agents. Pick the company at the top of the left sidebar. The list only has companies that are configured for Crew |
| **Project** | A code repo the agents work on. Each project has four roles: Assistant, Executor (writes code, 1 or 2 people), Reviewer (checks the work), Integrator (merges the code and pushes it) |
| **Agent** | Each role is held by one agent. Agents run Claude Code on your Mac |
| **Machine** | The Mac that runs the agents. It must be on, online, and running the 2P Crew app |
| **Working rules** | Every code request goes through fixed approval steps, with an automatic docs check and at most 5 fix rounds |

To give the team **a new repo**, use the **Add project** button on the [Projects](/projects) page (see section 8). To add another coder, use the **Create agent** button on the [Agents](/agents) page (see section 9). Both are on the web, no commands needed.

## 2. Sign in, change language, sign out

{{shot:login}}

1. Open the Crew address your administrator sent you.
2. Type your **Email** and **Password**, then press **Sign in**.
3. After signing in you land on the **Dashboard**.

Notes:
- **There is no "create account" button.** Open sign-up is switched off so strangers cannot get in. The administrator issues accounts.
- A wrong email or password shows "Wrong email or password". Just type again.
- Switch between Vietnamese and English on the [Settings](/settings) page, under **Language**. The choice is remembered in this browser.
- To sign out, open **Account** in the left sidebar and choose **Sign out**.
- When an app on the Mac asks to sign in, the browser opens the **Allow an app to sign in** page. Press **Allow** only if you just started that app yourself. If unsure, press **Cancel**.

## 3. Getting to know the main screen

{{shot:dashboard}}

**Left sidebar**, from top to bottom:
- **New request**: opens the dialog to create a request. This is the button you use most.
- **Search**: search requests and documents. You can also press Ctrl+K (Cmd+K on a Mac), type a request code such as `TPS-12` and press Enter to open it quickly.
- **Dashboard**: the number of agents running or paused, open requests, requests **awaiting your approval**, recent runs and the machine card.
- **Inbox**: everything waiting for you. The number next to it is the count of unread items.
- **Requests**: all requests of the company, with child requests under their parent.
- **Projects**, **Agents**: lists with readiness (section 10).
- **Skills**, **Machines**, **Docs**: sections 11, 12 and 13.
- **Guide**: the page you are reading.
- **Settings**: profile, language, system information.

The screen updates by itself: when an agent finishes a step, the status on the page changes and you do not need to reload.

## 4. Giving a request

{{shot:new-issue}}

1. Press **New request** in the left sidebar.
2. Choose a **Project**. The list only has projects that are **ready**. If a project is not ready, see section 10 to find out what is missing.
3. Choose the **Type**: Code, Bug or Research (table below).
4. Write a short **Title**, one sentence.
5. Write the **Description**. It helps to say:
   - **what you want** and **why**;
   - **where**: which page, which part;
   - **what must not be touched**, if anything.
6. You can add **Attachments**. A file with an unusual extension shows a warning before sending, and you can still send it.
7. The **Assignee** is always the project's Assistant and cannot be changed. Every request goes through the Assistant.
8. Press **Create**. If you do not want the team to start yet, press **Save draft (does not run)**: the request is saved but no agent runs.

**An example of a good request:**

> **Title:** Add a Japanese greeting to greet
>
> **Description:** The `greet` function can greet in vi and en. Add `ja` ("こんにちは"), with a test. Do not change the vi and en results.

**Three types of request:**

| Type | When | Notes |
|---|---|---|
| **Code** | Adding or changing a feature | Goes through every approval step |
| **Bug** | Something is broken | Describe the **symptom**: "pressing X shows Y, it should show Z". The agent finds the cause, writes a test that catches it, and only then fixes it |
| **Research** | You need a comparison or a proposal, no code change | Only two approval steps: the Reviewer and then you, and nothing is pushed. The company needs a "research" label; if it has none, the dialog says so and the type cannot be chosen |

Tip: **one request, one goal.** Two unrelated things mean two requests. Missing information is fine, the Assistant will ask.

## 5. Following a request

### 5.1 What happens after you give a request

```
You give it to the Assistant
  → the Assistant reads the project docs and asks if something is missing
  → the Assistant splits it into child requests, picks a model for each, hands them to the Executor
  → the Executor writes code (tests first, code second)  →  the Reviewer checks each child request
  → when every child request is done, the parent request goes through:
     (1) Reviewer  →  (2) Integrator merges the code and checks the docs  →  (3) YOU APPROVE  →  (4) Integrator pushes to the main branch
```

A small request usually takes 15 to 30 minutes, depending on difficulty and how busy the machine is.

### 5.2 Checking progress

{{shot:issue-detail}}

Open a request from the **Requests** or **Inbox** page. On the **Requests** page you can search, filter by status, project, assignee and type (Research or Code / Bug), sort, group and choose columns. Two columns belong to Crew:
- **Crew stage**: which step the request is at.
- **Child requests**: shown like "1/3 children done".

On a request page, the **Crew summary** line sits at the very top, for example "Crew · 1/1 children done · docs passed":
- **x/y children done**: how many child requests are finished out of the total.
- **Stage**: *Reviewer*; *Integrator · merge + docs*; *Owner approval* (waiting for you); *Integrator · push*; *Finished*.
- **docs**: *passed* means the docs match the code; *failed* means the Integrator will fix it; *none* means the check has not happened yet.

Press **Open map** to see a diagram of the work. Each box is the parent request or one child request, showing the kind of work, the stage, who is working on it and the fix round (for example 0/5). Dashed lines connect work that must finish first. Press **Close map** to fold it. Opening the map also shows the **Docs check** result.

Below that you find **Properties** (status, assignee, project, type, the model in use, stages and approvers, fix round) and **Comments**: the agents log every step here, and a running run shows live. You can edit the title and description, write comments and attach files. Comment lines starting with `crew-` are machine-readable evidence, see section 16.

### 5.3 When the Assistant asks a question

If the request is unclear, the Assistant puts a **question card** right in the request, titled "The assistant has a question", with ready-made choices and an **Other** box where you can type. The request is **Blocked** while it waits. Pick your answers and press **Send answer**, and the Assistant continues by itself.

Sometimes the Assistant needs you to **confirm** something: the card "The assistant needs confirmation" has two buttons, **Accept** and **Decline**. When declining, please put the reason in the **Reason (when declining)** box.

## 6. Approving, requesting changes, cancelling and reopening

When the stage is **Owner approval**, it is your turn. First look at:
- the Reviewer's comment;
- the **Docs check** result being passed;
- every child request being done.

Then choose a button at the top of the request page:

| Button | Use when | What happens |
|---|---|---|
| **Approve** | You agree with the result | The dialog shows an **Approval note** box, pre-filled with "Reviewed, approved." Edit it as you like, but it **cannot be empty**. Confirm and the Integrator pushes the code to the main branch and the request becomes **Done** |
| **Request changes** | You do not agree | Write **What needs fixing** (at least 5 characters) and press **Send change request**. The work goes back to the previous worker and counts as one more fix round |
| **Cancel request** | It is no longer needed | A confirmation box appears. The request becomes **Cancelled** and any run on the machine stops |
| **Reopen** | A done or cancelled request needs to be redone | A confirmation box appears. The request goes back to **To do** and every stage runs again in a new round |

Notes:
- **Approve** and **Request changes** appear only at the Owner approval stage, and only for the person assigned to approve.
- If 5 fix rounds are used up and the result still falls short, the request is escalated to you. Then you reply with a **comment** (say how to proceed); there is no Approve button.
- You cannot set the status to "Done" by hand. The reason is in section 15.
- A running run shows a **Stop run** button (with a confirmation box) in the request's run list.

## 7. Inbox and Dashboard

{{shot:inbox}}

The **Inbox** collects everything that needs you. Its tabs:
- **Awaiting my approval**: requests at the Owner approval stage and requests with an Assistant question waiting for you. Once approved, the request leaves this tab.
- **Mine**, **Unread**, **Stuck**, **All**: filter as you need.
- A dot on the left means unread. You can mark items read or unread, and **archive** an item (it only leaves the Inbox, the request stays).

The **Dashboard** gives the overall picture: number cards (agents, requests, **awaiting your approval**), recent runs with a "View run" link to read what the agent did, the **Machines** card and recent requests.

## 8. Adding a new project

{{shot:add-project}}

Press [Add project](/projects/new) on the Projects page. The wizard sets everything up for you. **The git repo must already exist on the Mac** (Crew does not download repos).

**Fill in the form:**
1. **Machine**: choose the Mac. A machine marked "App not running" means the 2P Crew app is not open, and the steps on the machine will wait.
2. **Repo folder on the machine**: the full path to the repo, for example `/Users/name/code/my-repo`. Folders checked before are suggested.
3. **Project key**: lowercase letters, digits and dashes, starting with a letter, 2 to 31 characters. The key names the agents and branches. A key already used by another project is rejected.
4. **Project name** and **Executors** (1 or 2).
5. Press **Start**.

**The wizard runs 7 steps by itself** and shows which is running, done or failed:

| Step | What it does |
|---|---|
| Check repo folder | The machine checks that the folder really is a git repo |
| Create project | Creates the project in the company |
| Create checkouts per role | The machine builds a separate working folder for each role |
| Create SSH environments | One per role, copied from the company's template environment |
| Create agents and AGENTS.md | One agent per role, with instructions for that role |
| Save roles | Records who holds which role |
| Check on the machine | The machine does a last check that everything runs |

If a step fails, the wizard **pauses the agents it already created**, shows the error and a **Continue** button. Press it to resume from the unfinished step without creating duplicates. It is fine to close the page midway: in the Projects list, an unfinished project has a **Continue** button. When it is done, press **Open project**.

## 9. Creating another agent

{{shot:add-agent}}

Press [Create agent](/agents/new) on the Agents page, used when you need another Executor or want to replace whoever holds a role. The wizard has 6 steps:
1. Name, project, role, default model and machine.
2. Pin the machine's Superpowers version and write the role's `AGENTS.md`.
3. Create a separate SSH environment for the agent.
4. The machine builds the agent's own working folder.
5. Record the agent's role in the project.
6. For an Executor: update the Assistant's `AGENTS.md` so the Assistant knows about the new person.

An agent that has not finished all 6 steps is **Not ready** and **does not appear** in any choice list. Press **Continue setup** (in the list or on the agent page) to finish it.

Only **a person on the web** can create agents. An agent cannot create another agent (see section 15).

## 10. Projects and Agents: viewing, changing roles, readiness

{{shot:projects}}

The [Projects](/projects) page lists projects with a **Readiness** column, the number of requests and a star button. Open a project to see its tabs:
- **Requests**: the project's requests.
- **Roles**: who holds which role. Press **Edit roles** to change them, then **Save roles**. After saving, the Assistant's `AGENTS.md` is updated to match.
- **Docs**: the project's documents (see section 13).
- **Readiness**: the checklist. A failing item has a **Continue** button that leads into the wizard.
- **Rename**: name, description, color, icon.

{{shot:agents}}

The [Agents](/agents) page lists agents with role, status and **Readiness**. You can filter **Running**, **Paused**, **Error**. **Pause** stops the agent and cancels its running run; **Resume** lets it run again. Open an agent to see:
- **Overview**: latest run, the request it is working on, machine, roles and anything still missing.
- **Instructions**: read `AGENTS.md`, read-only. **Re-render by role** writes the correct version for the current role. If someone just edited it you get a conflict and **nothing is overwritten**; reload and render again.
- **Skills**: enable or disable company skills for this agent, effective from the next run.
- **Runtime**: view the adapter, command, environment and machine. Only the **Default model** can be changed, chosen from Crew's model table.
- **Runs**: the agent's runs.

**Readiness** covers these checks: agent configuration is correct, Superpowers is pinned correctly, `AGENTS.md` matches the role, the SSH environment is correct, the working folder exists on the machine, and the agent holds a role. A project that is **not ready** does not appear in the New request dialog.

## 11. Skills

{{shot:skills}}

The [Skills](/skills) page lists the company's skills (extra abilities for agents), their source, how many agents use them and how many machines they are synced to.

**Add a skill:** press **Add skill**, paste a GitHub repo address (a branch or tag is optional), press **Scan repo**, choose the skills to add, optionally **Preview**, then press **Add skill**. A skill with the same name as a Superpowers skill that Crew has pinned cannot be added.

Open a skill to see its details, **Enable for agents** (one agent at a time) and the **Sync to machines** section showing whether each machine is synced, waiting or failed. There is a **Sync** or **Sync again** button. "Waiting for the 2P Crew app" means the app on the machine has not picked up the job; open the app and it is done.

## 12. Machines

{{shot:machines}}

The [Machines](/machines) page has one card per Mac that runs agents, refreshed every 30 seconds:
- **Online / Offline**: the machine reports every minute. After 3 minutes without a report it shows offline.
- **1-min load / CPU** and **free RAM**, with a 24-hour load chart. When the load is above 8 agents **wait** for the machine to calm down, so the machine does not freeze.
- **Pending TCC**: macOS is asking for permission and nobody has answered. The agent is blocked until someone presses **Allow** on the Mac screen.
- **Claude**: version, signed in or not, plan. **Superpowers**: the pinned version and the owner's version.
- **2P Crew app**: version and update state.
- **Unknown** means the machine could not read that value this time, which is not necessarily an error.

Below is the **Machine job queue**: jobs the machine has to do (inspect a repo folder, prepare checkouts, sync a skill, check a project) that are **Queued**, **Running** or **Failed**. Finished jobs are not listed. A failed job has a retry button.

## 13. Docs

{{shot:docs}}

The [Docs](/docs) page holds each project's documents, read from the latest snapshot a machine sent (it updates itself when the main branch gets a new commit):
- pick a project and see the commit and the time received;
- press a page in the tree to read it; links inside a page open the target page, and a broken link says "Missing page";
- the **Search the docs** box: type a keyword, for example `greet`;
- files that look like they contain passwords or tokens are **never uploaded**, only their names are listed under "Files dropped by the secret scan".

The **Docs** tab on a project page shows the same content inside that project.

## 14. Settings

{{shot:settings}}

The [Settings](/settings) page has three parts:
- **Profile**: edit your **Display name** and **Profile picture** (pick a new picture, then press **Save profile**; there is a **Remove profile picture** button).
- **Language**: Vietnamese or English.
- **System information**: server version, running commit, latest backup. Read-only.

## 15. Why there is no button X

If you know the original Paperclip and cannot find a button, it is almost always on purpose. There are three main reasons:
- **Rules that protect the approval flow.** Crew has automatic rules: a request always goes through the Assistant; you cannot set "Done" by hand to skip review, the docs check and the push; agent configuration cannot be edited freely.
- **Strict permissions.** **An agent cannot create another agent** and cannot grant itself permissions. **An agent cannot edit a project** (roles, name, settings). Only a person on the web can do that, through the wizards and the Projects and Agents pages, which check every step.
- **A complete flow instead.** Creating a project, creating an agent and adding a skill each have their own wizard in place of a bare form.

The table below lists each Paperclip feature that Crew does not have, where it lives in Paperclip, why, and what to do instead. Reason codes: **Not used by Crew**, **Blocked by rules**, **No flow yet**, **Later release**.

{{missing}}

## 16. Reading the `crew-…` lines in comments

| Line | Meaning |
|---|---|
| `crew-plan root=… children=… bundles=…` | The Assistant's plan: how many child requests, how many bundles |
| `crew-bundle id=… seq=…` | Which bundle a child request belongs to, and its order. Requests in the same bundle are done one after another by one Executor, who **remembers** the earlier context |
| `crew-model complexity=… model=…` | The difficulty and the chosen model: Sonnet for small and medium work, Opus for big work |
| `crew-stack on=TPS-…` | This work builds on the code of that other work |
| `crew-kind research` | Research work, no code change |
| `crew-review … verdict=approved` | The Reviewer approved |
| `crew-docs-check commit=… exit=0` | The Integrator checked the docs on the merged code. `exit=0` means passed |
| `crew-merge sha=… pushed=yes` | Pushed to the main branch |
| `crew-assistant done children=…` | The Assistant confirms every child request is done |

## 17. Common problems

| What you see | Cause | What to do |
|---|---|---|
| The machine card shows **Pending TCC** | macOS is asking permission for Claude Code | Go to the Mac screen, find the permission dialog and press **Allow**. If you cannot see it, open System Settings, Privacy & Security, Files and Folders, and turn on access for Claude |
| Machine is **Offline** | The Mac is off, offline, or the 2P Crew app is not open | Check the Mac is on and online, and reopen the 2P Crew app |
| A machine job says **Waiting for the 2P Crew app** | The app is not running, so it has not picked up the job | Open the 2P Crew app on the Mac |
| The request does not run | It was saved as a draft, or the Assistant is paused | Create it again without "Save draft"; check the [Agents](/agents) page to see whether the Assistant is **Paused** |
| The request is slow | The machine is overloaded (load above 8), agents are waiting | Close heavy apps on the Mac (simulators, test runners) |
| **Blocked** | Waiting for your answer, or for another child request | Open the request or look at the **Awaiting my approval** tab in the Inbox |
| docs **failed** | The code changed but the docs were not updated | The Integrator fixes it. If it keeps happening, tell the Assistant |
| A project is missing from the New request dialog | The project is not ready | Open the project's **Readiness** tab and press **Continue** |
| A wizard shows an error or stops at a step | The machine has not finished, or the step really failed | Read the error, open the app on the Mac if it says "Waiting for the app", then press **Continue** |
| "Someone just edited this agent's instructions" | Two places wrote `AGENTS.md` at once | Press **Reload**, then render again. The system never overwrites |
| The agent reports out of quota | The Claude plan on the Mac hit its limit (shared with your own Claude Code) | Wait for the limit to reset |

## 18. Glossary

| Word | Meaning |
|---|---|
| Request (parent) | The work you create and give to the Assistant |
| Child request | Work the Assistant splits off from the parent request |
| Bundle | A group of child requests in the same part of the code, done one after another by one Executor |
| Run | One time an agent runs |
| Stage | One step in the approval flow |
| Fix round | One time the Reviewer or you send the work back to be fixed (at most 5) |
| Role | Assistant, Executor, Reviewer, Integrator |
| Environment | The setting that tells an agent which machine and folder to run in |
| Checkout | An agent's own copy of the repo on the machine |
| Ready | A project or agent that meets every condition to take work |
| Superpowers | The working method (brainstorm, plan, test first) that agents follow |
