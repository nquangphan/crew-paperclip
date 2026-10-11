# Using 2P Crew

{{roles:owner}}
You are reading the **Owner** guide: every task, including the owner-only parts (approval, Members, Machines, pairing and unpairing machines, adding projects, runtimes). To see what other people see, pick a role in **Show the guide for** at the top right.
{{/roles}}
{{roles:operator}}
You are reading the **Admin / Operator** guide: daily work such as creating requests, following progress, and viewing projects, agents and machines. Owner-only parts (final approval, members, pairing machines, adding projects) are not here.
{{/roles}}
{{roles:viewer}}
You are reading the **Viewer** guide: you can browse the overview, requests, projects and docs, but you cannot create or change anything.
{{/roles}}
{{roles:contributor}}
You are reading the **Marketing** guide: how to send a request, write a comment and follow **My contributions**. Everything you send waits for the owner's approval before the agent team sees it.
{{/roles}}

Each section answers one task: **what it is**, **how to do it step by step**, then **tips**. Click a section name in the left column to jump to it; copy the address bar to send someone that exact section. Red numbers on the screenshots match **(1)**, **(2)** in the text.

## Getting started {#start}

### What 2P Crew is {#what-is-crew}

2P Crew is a team of AI agents that can program. You write a request in plain words, for example "add an Export to Excel button on the report page". The agents split the work, write code, review it, update the docs and push the code to the main branch. People only answer questions and approve at the last step.

| Part | What it is |
|---|---|
| **Company** | The workspace holding every request, project and agent. Pick it at the top of the left sidebar |
| **Project** | A code repository the agents work on |
| **Agent** | An AI "worker". Each project has four roles: Assistant, Executor (writes code), Reviewer (checks), Integrator (merges and pushes) |
| **Machine** | A Mac that runs agents, with the 2P Crew app open |
| **Request** | A task for the team. Every request goes through the Assistant and fixed approval steps |

Everyone signs in with a **role** in the company; the sidebar and buttons you see depend on it:

| Role | Can do |
|---|---|
| **Owner** | Everything: create requests, final approval, invite people, pair and unpair machines, add projects and agents, turn on runtimes |
| **Admin / Operator** | Daily work: create requests, follow progress, comment, view projects, agents, machines |
| **Viewer** | Browse the overview, requests, projects and docs. Cannot create or change anything |
| **Marketing** | Same as Viewer, plus sending requests and comments for the owner to approve |

{{roles:owner}}
Change someone's role, and choose which projects each person can see, on the [Members](/members) page.
{{/roles}}
{{roles:operator,viewer,contributor}}
Need a different role? Ask the company owner. You only see the projects the owner has given you and the requests in them; with no project yet, the lists are empty.
{{/roles}}

> **Tip:** you do not need to install anything to use the Crew web app. Only the machines that run agents need the 2P Crew app.

### Sign in, language, sign out {#sign-in}

{{shot:login}}

#### How to

1. Open the Crew address the owner sent you.
2. Enter your **Email** (1) and **Password** (2), click **Sign in** (3). You land on **Overview**.
3. Change language: click **VI** or **EN** at the bottom of the left sidebar, or open [Settings](/settings), **Language**. The choice is remembered in this browser.
4. Sign out: click your name at the bottom of the left sidebar and choose **Sign out**.

> **Tip:** there is no sign-up button. Accounts come from an owner invitation. A wrong email or password shows "Wrong email or password"; just try again.

{{roles:owner,operator}}
> **Note:** when the 2P Crew Mac app asks to sign in, the browser opens **Allow an app to sign in**. Click **Allow** only if you just started that app yourself. If unsure, click **Cancel**.
{{/roles}}

### Main screen and sidebar {#layout}

{{shot:shell}}

The left sidebar is grouped like the original Paperclip. On the screenshot:

1. **Company**: switch the company you are viewing (if you belong to several).
2. **Quick search**: opens the search box (section [Quick search](#quick-search)).
{{roles:owner,operator,contributor}}
3. **New request**: opens the create-request dialog. This is the button you use most.
{{/roles}}
4. **Guide**: the page you are reading.
5. **VI / EN**: change language.

The other groups:
{{roles:owner}}
- **Work**: Requests, **Pending approval** (Marketing contributions, the number is how many are waiting), Projects, Docs.
- **Org**: Agents, Skills, Machines.
- **System**: **Members**, Settings, Guide, **Open original Paperclip UI**.
{{/roles}}
{{roles:operator}}
- **Work**: Requests, Projects, Docs.
- **Org**: Agents, Skills, Machines.
- **System**: Settings, Guide.
{{/roles}}
{{roles:viewer}}
- **Work**: Requests, Projects, Docs.
- **System**: Settings, Guide.

You do not see Inbox, Agents, Skills and Machines because the Viewer role does not use those pages.
{{/roles}}
{{roles:contributor}}
- **Work**: Requests, **My contributions** (what you have sent), Projects, Docs.
- **System**: Settings, Guide.
{{/roles}}

> **Tip:** click a group title to collapse or expand it. Pages update by themselves when an agent finishes a step; no reload needed.

### Quick search {#quick-search}

{{shot:palette}}

Quick search opens a request by its id or title without leaving the page you are on.

#### How to

1. Click **Quick search** in the sidebar, or press **Ctrl+K** (Windows) or **Cmd+K** (Mac).
2. Type a request id like `CRE-12` or a few words of the title (1).
3. Pick a result with the arrow keys and press **Enter**. The request opens in a popup.

> **Tip:** the **Search** page in the sidebar searches deeper: also in comments and request documents.

## Daily work {#daily}

### Overview {#dashboard}

{{shot:dashboard}}

The **Overview** page gives the big picture of the company right after you sign in.

{{roles:owner,operator}}
- The **Agents** block at the top: recent runs. Click a card to read what the agent did; **View all runs** opens them all.
- Four number cards: **Agents enabled** (1), **Requests in progress**, **Blocked requests**, **Awaiting your approval** (2). Click a card to open the matching list.
{{/roles}}
{{roles:owner}}
- The **Contributions to approve** card (3): Marketing requests and comments waiting for you.
{{/roles}}
{{roles:viewer,contributor}}
- The number cards (1), (2) show how many agents there are and how many requests are in progress, stuck or awaiting approval. You only view them; nothing here waits for you.
{{/roles}}
{{roles:owner}}
- Three 14-day charts: **Run activity**, **Requests by status**, **Success rate**.
{{/roles}}
{{roles:operator,viewer,contributor}}
- The 14-day **Requests by status** chart. Request numbers and the chart only count the projects the owner has given you.
{{/roles}}
- The **Machines** card: which machines are online or offline.
- **Recent activity** and **Recent requests**: click a request to open its popup.

> **Tip:** times on every page use the Vietnam time zone.

### Request list {#issue-list}

{{shot:issues-list}}

The [Requests](/issues) page keeps the Paperclip list layout. Each row has a status icon, title, Crew stage, assignee, labels, id and update time. Sub-requests are indented under their root request; click the arrow to expand or collapse. A request with a run in progress shows **Live**.

The toolbar on the screenshot:

{{roles:owner,operator}}
1. **New request**: create a request (section [Create a new request](#new-request)).
{{/roles}}
{{roles:contributor}}
1. **New request**: send a request for the owner to approve (section [Send a request for approval](#send-request)).
{{/roles}}
2. **Search requests**: filter by words in the title or the id.
{{roles:owner,contributor}}
3. **Pending approval (n)**: show only the group of Marketing contributions waiting at the top of the list. Click again to show everything.
{{/roles}}
4. **Columns**: pick the columns shown on each row.
5. **Filter**: filter by status, assignee, project, kind.
6. **Sort**: recently updated, recently created, or by title. Sorted by date, the list shows **Today** and **Yesterday** dividers.
7. **Group**: group by status, assignee or project. Click a group title to collapse it.

{{shot:issues-filter}}

#### Filter the list

1. Click **Filter** (5).
2. Tick one value in each section: status, assignee, project, kind (**Research** or **Code / Bug**). The list updates right away.
3. Click a selected value again to remove it, or **Clear** to remove all. The button becomes **Filters: n** while n filters are on.

{{shot:issues-columns}}

#### Pick columns

1. Click **Columns** (4).
2. Turn each column on or off. Two Crew columns: **Crew stage** (which step the request is at) and **Child requests** (like "1/3 children done").
3. **Reset defaults** restores the original set.

> **Tip:** filters, search and grouping live in the page address. Copy the address to send someone the exact filtered view.

### Request popup {#issue-popup}

{{shot:issue-popup}}

Click a request in any list (Requests, Inbox, Search, Overview, a project's Requests tab) to open its details in a **popup** over the current page. The address gets `?issue=id`.

On the screenshot:
1. **Open full page**: see the full page in a new tab (or Cmd/Ctrl+click the request in a list).
2. Title, id, and the **Crew summary** line, for example "Crew · 1/3 children done · Owner approval · docs Pass":
   - **x/y children done**: finished sub-requests out of the total;
   - stage: *Reviewer*, *Integrator · merge + docs*, *Owner approval*, *Integrator · push*, *Done*;
   - **docs**: *Pass* means the docs match the code, *Fail* means the Integrator will fix them, *None* means the check has not run yet.
3. **Properties**: status, assignee, project, kind, model, stages and approver, review round (max 5), created and updated times. The **Runtime** group shows the chosen runtime and any automatic switches.

Below are the description, documents, attachments, the request's runs and **Comments**: agents log each step there and a live run streams in. **Open map** draws the root request and its sub-requests with the **Docs check** result.

Close the popup with **Esc**, the **×** button, a click on the backdrop, or the browser Back button: you return to the same place in the list.

{{roles:owner,operator}}
#### The path of a request

```
You give it to the Assistant
  → the Assistant reads the project docs, asks if something is missing
  → the Assistant splits it into sub-requests, picks models, assigns Executors
  → Executors write code (tests first)  →  the Reviewer approves each sub-request
  → the root request goes: (1) Reviewer → (2) Integrator merges, checks docs
     → (3) OWNER APPROVAL → (4) Integrator pushes to the main branch
```

A small request usually finishes in 15 to 30 minutes.

#### When the Assistant asks

If a request is unclear, the Assistant posts a **question card** in it ("Assistant needs to ask") with options and an **Other** box. The request becomes **Blocked** while waiting. Pick an answer and click **Send answer**; the Assistant continues. An "Assistant needs confirmation" card has **Accept** and **Decline** (give a reason when declining).

You can edit the title and description, comment and attach files. A running run has a **Stop run** button (with confirmation).
{{/roles}}
{{roles:owner}}
A request awaiting your approval has **Approve**, **Request changes**, **Cancel request** and **Force Done** right under the title (section [Approve, request changes, cancel, reopen](#approve)).
{{/roles}}
{{roles:operator}}
**Approve** and **Request changes** only show for the assigned approver, usually the owner. You still have **Cancel request** and **Reopen** when needed.
{{/roles}}
{{roles:viewer}}
You can read everything in the popup, but there is no comment box and no action button.
{{/roles}}
{{roles:contributor}}
Your comment box sends comments for the owner to approve (section [Contribution comments](#send-comment)). You cannot edit or change the status.
{{/roles}}

### Create a new request {#new-request roles=owner,operator}

{{shot:new-request}}

A request is the only way to give work to the agent team. Every request goes through the project's Assistant.

#### How to

1. Click **New request** in the sidebar or on the Requests page.
2. Pick the **Project** (1). Only **ready** projects are listed. If none is ready, the dialog says so (see [Projects](#projects)).
3. Pick the **Type** (2): **Code**, **Bug** or **Research** (table below).
4. Write a one-sentence **Title** (3) and a **Description** (4): what you want, why, where, and what must not change.
5. **Attach** images or files if needed. Unusual file types show a warning; you can still send them.
6. The **Assignee** is always the project's Assistant and cannot be changed.
7. Click **Create** (6). To keep the team from starting yet, click **Save draft (does not run)** (5).

| Kind | When | Notes |
|---|---|---|
| **Code** | Add or change a feature | Goes through every approval step |
| **Bug** | Something is broken | Describe the **symptom**: "clicking X gives Y, it should give Z". The agent writes a failing test first, then fixes |
| **Research** | Compare or propose, no code change | Only two approval steps: Reviewer then owner, no push. The company needs a "research" label |

> **Good example:** *Title:* Add an Export to Excel button on the report page. *Description:* The Revenue report needs an Export to Excel button; the file has Date, Order, Total columns. Do not change how totals are computed.

> **Tip:** one request, one goal. Two unrelated tasks make two requests. Missing details are fine; the Assistant will ask.

### Approve, request changes, cancel, reopen {#approve roles=owner}

{{shot:issue-gate}}

When the stage is **Owner approval**, it is your turn. The request shows in the **Awaiting your approval** card on Overview and in the **Awaiting my approval** tab of the Inbox.

#### How to

1. Open the request. Check the Reviewer's comment, that the **Docs check** passed and that every sub-request is done.
2. Pick a button at the top:

| Button | When | What happens |
|---|---|---|
| **Approve** (1) | You agree | The dialog has an **Approval note** prefilled with "Reviewed, approved."; it cannot be empty. Confirm and the Integrator pushes; the request becomes **Done** |
| **Request changes** (2) | You do not agree yet | Write **What needs fixing** (at least 5 characters), **Send change request**. The work goes back and counts one more review round |
| **Cancel request** (3) | No longer needed | Asks for confirmation. The request becomes **Cancelled** and running runs stop |
| **Force Done** (4) | Exceptional cases | Section [Force Done](#force-done) |
| **Reopen** | A done or cancelled request needs more work | The request goes back to **To do** and runs again in a new round |

> **Tip:** after 5 review rounds without success, the request comes to you to decide. Answer with a **comment** saying how to proceed; there is no Approve button then. There is no free status picker (the reason is in [Why there is no button X](#missing-buttons)).

### Force Done {#force-done roles=owner}

{{shot:force-done}}

**Force Done** closes a request right away even though some gates are still open. It is an escape hatch for exceptional cases (the work was done by hand outside Crew, or the flow is stuck and you checked the result yourself), not the normal way to approve.

#### How to

1. Click **Force Done** at the top of the request. The dialog lists **the gates that will be skipped** and the runs that will stop.
2. The **also cancel unfinished sub-requests** box is on by default: it cancels exactly the listed sub-requests, after the request is closed. Grandchildren are not cancelled.
3. Fill in the **Reason** (1), required, 10 to 1000 characters, then click **Force Done**.

Result: the request becomes **Done** with the **Forced Done** label; the reason becomes an owner comment; **History** records who forced it, when, and the skipped gates. Code that was not pushed is not pushed automatically.

> **Tip:** forced by mistake? Click **Reopen** to run it again from the start. If cancelling a sub-request fails, the page shows **Cancel the remaining sub-tasks**.

### Inbox {#inbox roles=owner,operator}

{{shot:inbox}}

The **Inbox** gathers what needs you. The number next to Inbox in the sidebar is the unread count.

#### How to

1. Open **Inbox** in the sidebar.
2. The **Awaiting my approval** tab (1): requests at the Owner approval step and Assistant questions waiting for your answer. Once handled, the item disappears.
3. The **Mine**, **Unread**, **Stuck**, **All** tabs filter as needed; there is a search box for id or title and a status filter.
4. A dot on the left means unread. Use **Mark as read**, **Mark as unread**, **Mark all as read**, or **Archive** an item (it only leaves the Inbox; the request stays).

> **Tip:** opening the Inbox each morning is enough to know what to do today.

### Runtime: Claude, Codex, OpenCode {#runtimes roles=owner,operator}

{{shot:machines}}

By default every agent runs on **Claude**. Two extra runtimes, **Codex** and **OpenCode**, are turned on per machine in the **Runtime** block (3) on the [Machines](/machines) page. The `crew-model` line in a sub-request description has `runtime=`, telling which runtime the Executor uses for that task (no `runtime=` means Claude).

{{roles:owner}}
#### Turn a runtime on or off

1. Open [Machines](/machines), find the machine card, the **Runtime** block.
2. Flip **Codex** or **OpenCode**. **Claude is on by default; Codex and OpenCode are off by default.** Turning one on asks for confirmation because new runs use your plan's quota.
3. If the machine lacks the runtime, click **Install runtimes on the machine** (it queues a job for the Mac app).

**Only the board** (the owner) should flip the switches; others see them for information. Turning a runtime off keeps waiting work queued or moves it to another agent; nothing is lost. OpenCode is locked while the server lacks the in-place working-directory patch; the card shows why.
{{/roles}}
{{roles:operator}}
The owner decides the runtime switches. You can see each runtime's state on the machine card.
{{/roles}}

#### The Runtime block of a request

A request's properties include a **Runtime** group listing decisions, newest first (up to 50 lines): **Selected** (runtime, agent, model and reason), **Switched** (Crew changed the runtime and why: out of quota, login or key error, runtime unusable, switch off) and **Switch refused** (wanted to switch but it was not safe).

**Automatic runtime switch** for Executors:
- Only after a run fails because of quota, a login or key error, or an unusable runtime, or when the switch is off while work is waiting.
- It moves to another agent on the **same machine** that is free and switched on. A request switches at most **2 times**.
- **large** tasks are not blocked when nothing is free: the task waits for Claude quota and then continues.
- If the old working directory has uncommitted changes, Crew does not switch: it comments and sets the request to **Blocked**.

The **Codex Reviewer** only reviews **code sub-requests**. If it fails (including out of quota) or the Codex switch goes off midway, Crew **switches back to the project's Claude Reviewer**, keeping the review round count.

> **Tip:** the **kimi-k3** model (OpenCode) currently **does not accept images**. Leave tasks with image attachments to Claude or Codex.

## Marketing {#marketing}

### What Marketing is {#marketing-overview roles=owner,contributor}

{{roles:contributor}}
{{shot:contributions-mine}}
{{/roles}}
{{roles:owner}}
{{shot:contributions-owner}}
{{/roles}}

**Marketing** members can view every project, request and comment, and can send **requests** and **comments** for the owner to approve. While waiting, **agents see nothing**: pending content is not in any list, comment thread or agent context, so no agent is woken up. Only the owner can approve or reject.

| Status | Meaning |
|---|---|
| **Pending** | Sent, the owner has not looked yet |
| **Approved** | The owner posted it; agents start as if the owner had posted it |
| **Rejected** | The owner did not post it. The item stays, visible only to the sender and the owner; agents never see it |

{{roles:contributor}}
Marketing members cannot edit, change status, assign work or delete anything.
{{/roles}}

### Send a request for approval {#send-request roles=contributor}

{{shot:contribution-new}}

#### How to

1. Click **New request** in the left sidebar. The **Send a request (needs approval)** dialog opens.
2. Pick the **Project** (1).
3. Write a one-sentence **Title** (2) and a **Description**: what you want, on which page, and why.
4. Click **Send for approval** (3). The dialog confirms it was sent and is waiting for the owner.

You do not pick the kind, assignee or attachments: the owner chooses them when approving.

> **Tip:** write as if messaging the person doing it: "Change the home page banner for the November campaign, keep the text". One request, one task.

### Contribution comments {#send-comment roles=contributor}

{{shot:contribution-comment}}

#### How to

1. Open a request (click it on the Requests page).
2. Scroll to the comment box and write your comment.
3. Click **Send for approval** (2). The comment shows in the thread right away with the **Pending** label (1); only you and the owner see it.

When the owner approves, the comment is posted under the owner's name with a **Contributed by <your name>** line, and agents are notified as if the owner had commented.

### Follow My contributions {#my-contributions roles=contributor}

{{shot:contributions-mine}}

The [My contributions](/contributions) page lists everything you have sent.

#### How to

1. Click **My contributions** in the left sidebar.
2. Pick a tab (1): **Pending**, **Rejected** or **Approved**.
3. **Approved** items link to the real content: **Open the created request** or **View the posted comment**.

> **Tip:** **Rejected** items are kept so you can look back. To try again, rework the content and send a new request.

### Approve or reject contributions {#review-contributions roles=owner}

{{shot:contributions-owner}}

The **Pending approval** item in the left sidebar shows how many items wait; Overview has a **Contributions to approve** card. Approve on the [Pending approval](/contributions) page (tabs (1)), in the **Pending approval** group at the top of [Requests](/issues), or right in a comment thread.

{{shot:contribution-approve}}

#### Approve a request

1. Click **Approve** (2) on the request row.
2. The **Approve request** dialog lets you pick the **Project**, **Type** (Code, Bug, Research), the **Assigned agent** (defaults to the project's Assistant) and **Save as draft**.
3. Click **Approve**. The request is posted word for word as if you had posted it, and agents start (unless saved as draft).

#### Approve a comment

Click **Approve** once: the comment is posted under your name with a **Contributed by <name>** line, and agents are notified as if you had commented.

#### Reject

Click **Reject** (3) and confirm. The item gets the **Rejected** label, visible only to the sender and you.

> **Tip:** if an approval is cut off midway (network loss, closed tab), the item shows **Partly approved** with an **Approve again** button; clicking it never creates a duplicate. If two owners approve the same item, the second one is told someone else is approving.

## Projects and agents {#projects-agents}

### Projects {#projects roles=owner,operator,viewer}

{{shot:projects}}

The [Projects](/projects) page lists projects with their request count and a **Ready** column (2). A project that is **not ready** is missing from the New request dialog.

{{roles:owner,operator}}
- **Add project** (1): build a new project with the wizard (an owner task).
- **In use / Removed** (3): removed projects only show under **Removed**.
- Click the star to pin a project in the sidebar, right under Projects.
- A project that is not ready has a **Continue setup** button leading to the wizard.
{{/roles}}
{{roles:viewer}}
You only view; there are no add or edit buttons.
{{/roles}}

{{shot:project-roles}}

#### The tabs of a project

Click a project name. The tabs at the top (1):
- **Requests**: the project's requests.
- **Roles**: who holds Assistant, Executor, Reviewer, Integrator.
- **Docs**: the project documentation.
- **Readiness**: the checklist; failing items have a **Continue** button.

{{roles:owner,operator}}
- **Rename**: name, description, color, icon.

#### Change who holds a role

1. Open the **Roles** tab, click **Edit roles** (2).
2. Pick an agent for each slot, click **Save roles**. The Assistant's `AGENTS.md` is updated to match.
{{/roles}}

**Ready** means: agent configuration correct, the right Superpowers pinned, `AGENTS.md` matches the role, SSH environment correct, working directory present on the machine, and the agent holds the role.

### Add a project {#add-project roles=owner}

{{shot:add-project}}

Click [Add project](/projects/new) on the Projects page. The wizard builds everything; **the git repository must already be on the Mac** (Crew does not clone it).

#### How to

1. **Machine**: pick the Mac. "App not running" means the 2P Crew app is closed and machine steps will wait.
2. **Repo folder on the machine**: the full path, for example `/Users/name/code/my-repo`. Folders checked before are suggested.
3. **Project key**: lowercase letters, digits, dashes, starting with a letter, 2 to 31 characters. It must not clash with an existing project.
4. **Project name** and **Executors** (1 or 2), then **Start**.
5. The wizard runs 7 steps and shows each: check the repo folder, create the project, create checkouts per role, create SSH environments, create agents and AGENTS.md, record roles, check on the machine.
6. When done, click **Open project**.

> **Tip:** if a step fails, the wizard pauses the agents it created, shows the error and a **Continue** button that resumes from that step without duplicates. Closing the page midway is fine; the unfinished project has **Continue setup** in the list.

### Agents {#agents roles=owner,operator}

{{shot:agents}}

The [Agents](/agents) page lists agents with their role, status and **Ready**. Click **Create agent** (1) to add one (an owner task); filter (2) by **Running**, **Paused**, **Error**, **Removed**.

{{shot:agent-detail}}

#### View and control an agent

1. Click an agent name. The tabs (1):
   - **Overview**: last run, current request, machine, role, missing items.
   - **Instructions**: view `AGENTS.md` (read-only). **Re-render by role** writes the correct version; if someone just edited it, you get a conflict and nothing is overwritten.
   - **Skills**: turn skills on or off for this agent, effective from the next run.
   - **Runtime configuration**: adapter, command, environment, machine. Only the **Default model** can be changed.
   - **Runs**: past runs.
2. **Pause** stops the agent and cancels its running run; **Resume** lets it run again.

> **Tip:** an agent that has not finished its setup steps is **Not ready** and does not appear in any picker. Click **Continue setup** to finish.

### Create an agent {#add-agent roles=owner}

{{shot:add-agent}}

Use it to add an Executor or replace a role holder. Open it with [Create agent](/agents/new) on the Agents page, or **Add executor** on a project's Roles tab.

#### How to

1. Pick the **Project** and the **Role slot**, name the agent, pick the **Model** and **Machine**. A project with no roles yet also needs a **Project key** and **Repo folder on the machine**.
2. Click **Start**. The wizard runs 6 steps: create agent, pin Superpowers and AGENTS.md, SSH environment, build the checkout on the machine, record the role, update the Assistant's AGENTS.md.
3. When done you get **Open agent** and **Open project**. If a step stops, click **Continue**.

> **Tip:** only people on the web can create agents. An agent cannot create another agent.

### Remove a project or an agent {#remove roles=owner}

{{shot:project-roles}}

Removing means **stop using it but keep the data**; nothing is deleted.

#### Remove a project

1. Open the project, click **Remove project** (3) at the top.
2. Type the project name to confirm. The dialog lists what will happen.
3. Crew pauses the role agents, clears the roles, archives their environments, removes **clean** checkouts on the machine and archives the project. Git branches, the source folder and unfinished requests stay.

#### Remove an agent

{{shot:agent-detail}}

1. Open the agent, click **Remove agent** (2).
2. The agent leaves its role (the Assistant's `AGENTS.md` is updated), is paused, its environment is archived and its clean checkout is removed. The agent is not deleted.
3. If the agent is a project's only Assistant, reviewer, integrator or executor, the button is disabled with the reason and links to **Change roles** or **Remove whole project**.

> **Tip:** checkouts with uncommitted changes are kept; the progress page gives a `git worktree remove` command to run yourself after checking. If something fails midway, the button becomes **Continue removing project** or **Continue removing agent**. To use them again: run Add project for a project; click **Resume** on an agent and assign it a role.

### Skills {#skills roles=owner,operator}

{{shot:skills}}

The [Skills](/skills) page lists the company's skills (extra abilities for agents), their source, how many agents use them and how many machines have them synced.

#### Add a skill

1. Click **Add skill** (1), paste a GitHub repository address (optionally a branch or tag), click **Scan repo**.
2. Pick skills, **Preview** if needed, then **Add skill**.
3. Open the skill and **Enable for agents** where needed. **Sync to machines** shows whether each machine is synced, waiting or failed.

#### Edit, update, delete

- **Edit details** changes the display name and description; to edit files, pick a file, edit, **Save file**. Only Crew-managed skills are editable; when two people save at once, the last save wins.
- **Check for updates** and **Update from source** for GitHub skills. A read-only skill can be turned into **Create an editable copy**.
- **Change source**: **Add from a new source**, enable it for the agents, then **Delete skill** on the old one.
- **Delete skill**: type the name to confirm. Crew removes the skill from agents first, then deletes it; copies on machines are cleaned through the job queue.

> **Tip:** "Waiting for the 2P Crew app" means the app on the machine has not taken the job yet. Opening the app on the Mac fixes it.

### Docs {#docs}

{{shot:docs}}

The [Docs](/docs) page is each project's documentation, read from the latest copy a machine sent (it updates when the main branch gets a new commit). Before any machine sends one, the page says no project has docs yet.

#### How to

1. Pick a project; the page shows the commit and when it arrived.
2. Click a page in the tree (1) to read it. Links open the target page; broken links say "Missing page".
3. Type a keyword in **Search the docs** (2).

> **Tip:** files that look like they hold passwords or tokens are never sent; only their names appear under "Files skipped by the secret scan". A project's **Docs** tab shows the same content.

## Machines {#machines-group}

### Machines page {#machines roles=owner,operator}

{{shot:machines}}

The [Machines](/machines) page has one card per Mac that runs agents, refreshed every 30 seconds.

- **Online / Offline** (4): machines report every minute; after 3 minutes without a report they show as offline.
- **1-minute load / CPU count** and **free RAM**, with a 24-hour chart. Above a load of 8, agents wait for the machine to calm down before running.
- **Pending TCC**: macOS is asking for a permission nobody clicked; agents are blocked until someone clicks **Allow** on the Mac.
- **Claude** (version, login, plan), **Superpowers** (pinned version), **2P Crew app** (version, updates). "Unknown" means the machine could not read that value this time.
- Pairing label (2): **Paired <time>** is a machine paired automatically by the app; **Unpaired <time>** is a machine that was unpaired. Older machines using the company's shared secret have no label.
- The **Runtime** block (3): section [Runtime](#runtimes).

Below is the **Machine job queue**: jobs a machine has to do (inspect a repo folder, build checkouts, sync skills, check a project, install runtimes) that are **Queued**, **In progress** or **Failed**. Failed jobs have a retry button.

{{roles:operator}}
> **Note:** pairing, unpairing and runtime switches are owner tasks. If a machine stays offline, tell the owner.
{{/roles}}

### Pair a machine with the 2P Crew app {#pair-machine roles=owner}

{{diagram:mac-pairing}}

A new Mac joins the company through the **2P Crew** app, and you **do not paste any key or secret**. The diagram shows the steps of the app's wizard (they cannot be captured from the web). The app is in Vietnamese; button names are quoted below with a translation.

#### How to

1. Install and open the 2P Crew app on the Mac. The wizard goes through: **Check machine** (macOS, Node, Tailscale, Claude Code) → remove the old app if any → move to Applications → **Sign in to Paperclip**.
2. At sign-in, the app opens the browser; click **Allow** on the Crew page.
3. **Pick the company** for the machine. The picker starts empty and Next stays locked until you choose: the app never picks a company for you.
4. On the **Máy này** (This machine) step, check the line **Ghép vào company: <name>** (Pair into company) and click **Ghép máy** (Pair machine). The app creates the SSH environment `may-<machine name>`, pairs the machine with the Crew plugin, receives the machine's own key (stored in Keychain) and sends a test report.
5. Continue through **Disk access** (grant Full Disk Access), **sshd** and **Check** to **Done**.
6. Open [Machines](/machines): the new machine shows **Paired <time>**.

#### Change company or re-pair

The app's **Done** screen has a **Company and machine** box with the **Đổi company / Ghép lại máy** (Change company / Re-pair machine) button. Use it when the machine was paired to the wrong company, or after you **Unpair** it on the web and want it back. Click it, the app returns to the sign-in step; pick the company and go through the steps again. For an unpaired machine, the This machine step shows **Ghép lại máy này** (Re-pair this machine): only that button re-pairs an unpaired machine.

> **Tip:** the Done screen warns that the machine does not report its status to Paperclip when the latest report was rejected (for example, it was just unpaired). Click **Đổi company / Ghép lại máy** to fix it. If the server says it has no Paperclip key, ask the server administrator; the **Nhập tay (dự phòng)** (manual fallback) box is only for guided cases.

### Unpair and re-pair a machine {#unpair-machine roles=owner}

{{shot:machine-unpair}}

Unpair a machine so it stops getting new runs. Other machines are not affected and no environment is deleted.

#### How to

1. Open [Machines](/machines), find the machine card, click **Unpair machine** (1 on the Machines page screenshot). Only owners see this button.
2. Read the confirmation and click **Unpair**:
   - a **paired** machine: Crew checks the environment really belongs to it (by Tailscale IP), archives the environment, then revokes the machine key;
   - an **unpaired-style** machine (using the company's shared secret): the confirmation warns more strongly; Crew only blocks its reports and does not archive any environment.
3. The card switches to **Unpaired <time>** and the button goes away.
4. To use it again: open the 2P Crew app **on that machine**, click **Đổi company / Ghép lại máy**, then **Ghép lại máy này** on the This machine step.

> **Tip:** if a step fails, the page shows the exact error and the button stays; clicking again continues safely. The button is only the UI: to block an unpaired machine completely, also revoke the board key the app on that machine holds.

## System {#system}

### Members {#members roles=owner}

{{shot:members}}

The [Members](/members) page is owner-only: members and their roles, Marketing invitations and join requests.

#### Invite Marketing

1. Click **Invite Marketing** (1). Copy the link (like `…/paperclip/invite/…`) and send it. The link is shown only once.
2. The person opens the link, signs up or signs in, and sends a join request.
3. Under **Pending join requests**, the row labelled **Marketing invite**: click **Approve**. The person now has the **Marketing** role.

#### Set or remove Marketing

Viewer members have **Set Marketing**; Marketing members have **Remove Marketing** (2), after which they can only view.

#### Choose which projects each person can see

{{shot:project-access}}

Every member except owners (Admin, Operator, Viewer, Marketing) only sees the projects you give them. A new member sees no project at all. Owners always see everything; their column shows **All**.

1. In the **Visible projects** column, click the person's button (1). It shows the projects already given, or **No project yet**.
2. Tick or untick each project (2), then click **Save** (3).
3. When the person reloads the page they see exactly those projects, with their requests, Overview numbers and search results. Requests without a project are only visible to owners.

> **Note:** this hides projects in the Crew UI only. Anyone who opens the original Paperclip UI or the core API can still read them. Marketing contributions are enforced on the server: they cannot be sent to a project that was not given, and you cannot approve a contribution from someone who lost access to that project.

> **Tip:** active invitations are listed below with their expiry; click **Revoke** to disable a link.

### Settings {#settings}

{{shot:settings}}

The [Settings](/settings) page has three sections:
- **Profile**: edit your **Display name** and **Profile picture**, click **Save profile** (there is **Remove profile picture**).
- **Language**: Vietnamese or English.
- **System information**: server version, running commit, latest backup. Read-only.

### Original Paperclip UI {#stock-ui roles=owner}

{{shot:stock-ui}}

Crew runs on Paperclip. The original Paperclip interface is still available at `/paperclip/` on the same domain.

#### How to

1. Click **Open original Paperclip UI** (1) at the bottom of the left sidebar (or in the account menu).
2. A new tab opens the matching page in the original UI: a request, project or agent opens that same object; other pages open the original UI's home page.

> **Note:** only owners see this item. Use the original UI to look or compare. The actions Crew blocks are blocked for a reason (section [Why there is no button X](#missing-buttons)); doing them in the original UI can break the approval flow.

## Reference {#reference}

### Why there is no button X {#missing-buttons roles=owner,operator,viewer}

If you know the original Paperclip and miss a button, it is usually on purpose:
- **Rules protecting the approval flow.** Requests always go through the Assistant; there is no free status picker that skips review, docs check and push (in exceptional cases the owner uses **Force Done** with a reason); agent configuration cannot be edited freely.
- **Strict permissions.** **An agent cannot create another agent**, cannot grant itself permissions and **cannot edit projects**. Only people on the web do that, through wizards that check each step.
- **Full flows instead.** Creating projects and agents, adding skills, removing projects and agents have step-by-step flows instead of a bare form or delete button.

The table lists each Paperclip feature Crew does not have, where it is in Paperclip, why, and what to do instead. Reason codes: **Not used by Crew**, **Blocked by rules**, **No flow yet**, **Later release**.

{{missing}}

### Reading crew- lines in comments {#crew-lines roles=owner,operator,viewer}

Agent comments contain lines starting with `crew-`: machine-readable evidence.

| Line | Meaning |
|---|---|
| `crew-plan root=… children=… bundles=…` | The Assistant's plan: how many sub-requests and bundles |
| `crew-bundle id=… seq=…` | Which bundle a sub-request is in, and its position. One Executor does a bundle in order and keeps the context |
| `crew-model complexity=… model=… effort=… runtime=…` | Difficulty, model and runtime: Sonnet for small and medium work, Opus for large. `runtime=` is `claude_local`, `codex_local` or `opencode_local`; missing means Claude |
| `crew-stack on=CRE-…` | This task builds on the code of another |
| `crew-kind research` | A research task, no code change |
| `crew-review … verdict=approved` | The Reviewer approved |
| `crew-docs-check commit=… exit=0` | The Integrator checked the docs on the merged code; `exit=0` means pass |
| `crew-merge sha=… pushed=yes` | Pushed to the main branch |
| `crew-assistant done children=…` | The Assistant confirms every sub-request is done |

### Troubleshooting {#troubleshooting}

| You see | Cause | Fix |
|---|---|---|
| "Wrong email or password" | A typo | Try again; ask the owner if you forgot the password |
| A sidebar item is missing | Your role does not use that page | See [What 2P Crew is](#what-is-crew) |
{{roles:owner,operator}}
| You see | Cause | Fix |
|---|---|---|
| A project is missing from New request | The project is not ready | The project's **Readiness** tab, click **Continue setup** |
| A request does not run | Saved as draft, or the Assistant is paused | Create it again without "Save draft"; check [Agents](/agents) |
| A request sits for long | The machine is overloaded (load above 8) | Close heavy apps on the Mac |
| **Blocked** | Waiting for your answer, or for another sub-request | Open the request or the Inbox **Awaiting my approval** tab |
| docs **Fail** | Code changed but the docs did not | The Integrator fixes it; if it repeats, message the Assistant |
| Machine card shows **Pending TCC** | macOS is asking permission for Claude Code | Click **Allow** on the Mac, or System Settings → Privacy & Security → Files and Folders |
| Machine **Offline** | The Mac is off, offline, or the app is closed | Check the Mac and network, reopen the 2P Crew app |
| A machine job says **Waiting for the 2P Crew app** | The app is not running | Open the 2P Crew app on the Mac |
| An agent reports out of quota | The Claude plan on the Mac hit its limit | Wait for the limit to reset, or ask the owner to turn on Codex/OpenCode |
{{/roles}}
{{roles:owner}}
| You see | Cause | Fix |
|---|---|---|
| The app says the machine does not report its status to Paperclip | The machine was unpaired or paired to the wrong company | **Đổi company / Ghép lại máy** in the app (section [Pair a machine](#pair-machine)) |
| The Runtime block says **Switch refused** | No free switched-on agent on the same machine, or already switched twice | Turn a switch on on the Machines page or wait for quota |
| A wizard stays on a step | The machine has not finished, or a real error | Read the error, open the Mac app if it says "Waiting for app", click **Continue** |
{{/roles}}
{{roles:contributor}}
| You see | Cause | Fix |
|---|---|---|
| An item under **Rejected** | The owner did not post it | Ask the owner why, rework it and send a new request |
| An item stays long under **Pending** | The owner has not looked yet | Message the owner; agents only start after approval |
{{/roles}}

### Glossary {#glossary}

| Term | Meaning |
|---|---|
| Request (root) | A task given to the Assistant |
| Sub-request | A task the Assistant splits off a root request |
| Bundle | Sub-requests in the same code area, done in order by one Executor |
| Run | One agent execution |
| Stage | One step of the approval flow |
| Review round | One time the Reviewer or the owner sends work back (max 5) |
| Role (project) | Assistant, Executor, Reviewer, Integrator |
| Environment | Configuration telling an agent which machine and folder to run in |
| Checkout | An agent's own copy of the repository on the machine |
| Ready | A project or agent meets every condition to take work |
| Machine pairing | Joining a Mac to the company through the 2P Crew app; the machine gets its own key |
| Superpowers | The working method (brainstorm, plan, test first) agents use |
| Marketing | A member who views and sends requests and comments for the owner to approve |
