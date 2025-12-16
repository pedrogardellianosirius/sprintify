# Sprintify Application Flow Documentation

This document describes the complete flow of the Sprintify application, from user interaction to ticket generation and integration with external project management tools.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [User Flow](#user-flow)
3. [API Endpoints](#api-endpoints)
4. [Agent Workflow (Graph)](#agent-workflow-graph)
5. [Integration Flow](#integration-flow)
6. [Data Persistence](#data-persistence)
7. [Key Components](#key-components)

---

## Architecture Overview

Sprintify is a monorepo application with two main packages:

- **`apps/web`**: Next.js frontend application
- **`apps/agent`**: Node.js agent package that handles LLM-based ticket generation

### Technology Stack

- **Frontend**: Next.js 15, React 19, TypeScript
- **Backend**: Next.js API Routes
- **Agent**: LangGraph, LangChain, OpenAI
- **Integrations**: Jira API, Linear API
- **Storage**: File system (JSON files)

---

## User Flow

### 1. Application States

The frontend has three main states:

1. **`integration`**: Configure integration with Jira/Linear (optional)
2. **`upload`**: Upload document or paste text
3. **`tickets`**: View and manage generated tickets

### 2. Complete User Journey

```
┌─────────────────────────────────────────────────────────────┐
│                    USER STARTS APPLICATION                   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  STATE: integration                                          │
│  - User can configure Jira/Linear integration (optional)     │
│  - User can skip integration configuration                    │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  STATE: upload                                               │
│  - User uploads PDF/document OR pastes text                 │
│  - User clicks "Generate Tickets"                            │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  POST /api/generate                                          │
│  - Validates input (text or fileData)                        │
│  - Creates streaming response (Server-Sent Events)          │
│  - Calls runAgent() with integration config                  │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  AGENT WORKFLOW (see Agent Workflow section)                 │
│  - Streams progress events back to frontend                   │
│  - Returns complete ProjectState                             │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  STATE: tickets                                              │
│  - Display generated tickets                                 │
│  - User can edit tickets via chat                             │
│  - User can push tickets to Jira/Linear                      │
│  - User can export tickets                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### 1. **POST /api/generate**

**Purpose**: Generate tickets from document/text

**Request Body**:

```typescript
{
  text?: string;                    // Pasted text
  fileData?: string;                 // Base64 encoded file
  fileName?: string;                 // File name
  integrationConfig?: IntegrationConfig;  // Optional integration config
}
```

**Response**: Server-Sent Events (streaming)

- Events: `status`, `progress`, `error`, `complete`
- Final event contains full `ProjectState`

**Flow**:

1. Validates input schema
2. Converts base64 file to Buffer if needed
3. Creates streaming TransformStream
4. Calls `runAgent()` with streaming callback
5. Returns SSE stream

---

### 2. **POST /api/edit**

**Purpose**: Edit existing tickets using natural language

**Request Body**:

```typescript
{
  projectId: string;
  instruction: string; // e.g., "split ticket 3 into 2 tickets"
}
```

**Response**: Updated `ProjectState`

**Flow**:

1. Loads existing project
2. Calls `editTickets()` with instruction
3. Uses batched edit service for large operations
4. Returns updated project state

---

### 3. **GET /api/projects**

**Purpose**: List all projects with metadata

**Response**: Array of project metadata (id, name, createdAt, etc.)

---

### 4. **GET /api/projects/[id]**

**Purpose**: Load full project by ID

**Response**: Complete `ProjectState`

---

### 5. **POST /api/integrations/test**

**Purpose**: Test connection to Jira/Linear

**Request Body**:

```typescript
{
  type: "jira" | "linear";
  credentials: JiraCredentials | LinearCredentials;
  projectMapping: ProjectMapping;
}
```

**Response**: `{ success: boolean, message: string }`

**Flow**:

1. Validates config schema
2. Attempts to read 1 issue from external system
3. Returns success/failure

---

### 6. **GET /api/integrations/config**

**Purpose**: Get integration config for a project (without credentials)

**Query Params**: `projectId`

**Response**: `{ type: string, projectMapping: ProjectMapping }`

---

### 7. **POST /api/integrations/config**

**Purpose**: Save integration configuration

**Request Body**:

```typescript
{
  projectId: string;
  config: IntegrationConfig;
}
```

**Response**: `{ success: boolean }`

---

### 8. **DELETE /api/integrations/config**

**Purpose**: Delete integration configuration

**Query Params**: `projectId`

**Response**: `{ success: boolean }`

---

### 9. **POST /api/integrations/push**

**Purpose**: Push tickets to Jira/Linear

**Request Body**:

```typescript
{
  projectId: string;
  ticketIds?: string[];  // Optional: specific tickets, otherwise all
}
```

**Response**: `PushResult` with success status per ticket

**Flow**:

1. Loads project and integration config
2. Filters tickets if `ticketIds` provided
3. Creates issues in external system
4. Saves external mappings (ticket.id → external issue key)
5. Returns results

---

### 10. **POST /api/export**

**Purpose**: Export project as JSON/CSV/Markdown

**Request Body**:

```typescript
{
  projectId: string;
  format: "json" | "csv" | "md";
}
```

**Response**: File download with appropriate content type

---

### 11. **POST /api/cost**

**Purpose**: Get cost information for a project

**Request Body**:

```typescript
{
  projectId: string;
}
```

**Response**: `{ tokensIn: number, tokensOut: number, usd: number }`

---

## Agent Workflow (Graph)

The agent uses LangGraph to orchestrate a multi-step workflow. The graph processes documents through the following nodes:

### Graph Structure

```
parse → security → readExternal → extract → rag → generate → validate → persist → embed → END
```

### Node Details

#### 1. **parse** Node

- **Input**: `GraphState` with `rawText` (empty initially)
- **Action**: Extracts text from document (already done before graph)
- **Output**: Returns `rawText` unchanged

#### 2. **security** Node

- **Input**: `rawText`
- **Action**:
  - Runs security checks (sanitization, size limits)
  - Validates content is safe to process
- **Output**: Sanitized `rawText` or `error`

#### 3. **readExternal** Node (Optional)

- **Input**: `integrationConfig` or `projectId`
- **Action**:
  - Checks if integration is configured
  - Reads existing tickets from Jira/Linear (up to 100)
  - Formats tickets as context string
- **Output**: `externalTicketsContext` (string) or empty
- **Note**: This runs BEFORE extraction to provide context

#### 4. **extract** Node

- **Input**: `rawText`, `externalTicketsContext`
- **Action**:
  - Uses LLM to extract structured requirements
  - Generates: projectName, summary, goals, constraints, features, stakeholders, techHints, scope
- **Output**: `requirements` (Requirements object)
- **LLM Call**: OpenAI with extraction prompt

#### 5. **rag** Node (Optional)

- **Input**: `requirements.summary`
- **Action**:
  - Searches for similar past projects using embeddings
  - Provides suggestions based on similar work
- **Output**: Suggestions (optional, doesn't fail on error)

#### 6. **generate** Node

- **Input**: `requirements`, `externalTicketsContext`, `batchContext`
- **Action**:
  - Splits features into batches (3 features per batch)
  - For each batch:
    - Builds prompt with external tickets context (if available)
    - Includes batch context from previous batches
    - Calls LLM to generate tickets
    - Validates and parses response
  - Combines all tickets
- **Output**: `tickets` (array of Ticket objects)
- **LLM Call**: OpenAI with ticket generation prompt

#### 7. **validate** Node

- **Input**: `tickets`, `requirements`
- **Action**:
  - Validates tickets against requirements
  - Checks for missing features, incomplete tickets, etc.
  - Logs issues but doesn't fail
- **Output**: Validation results (optional)

#### 8. **persist** Node

- **Input**: `projectId`, `rawText`, `requirements`, `tickets`, `cost`
- **Action**:
  - Creates or updates project file
  - Saves to `data/projects/{projectId}.json`
  - Preserves `externalMappings` if they exist
- **Output**: `projectId`

#### 9. **embed** Node (Optional)

- **Input**: `tickets`, `projectId`
- **Action**:
  - Generates embeddings for all tickets
  - Detects potential duplicates (similarity > 0.85)
  - Saves embeddings to `data/embeddings/{projectId}.json`
- **Output**: Embeddings and duplicate detection results

### Graph State

The graph maintains state through all nodes:

```typescript
interface GraphState {
  projectId?: string;
  rawText: string;
  requirements?: Requirements;
  tickets: Ticket[];
  cost: Cost;
  error?: string;
  createdAt?: string;
  externalTicketsContext?: string; // From readExternal node
  batchContext?: BatchContext; // For cross-batch coherence
  integrationConfig?: IntegrationConfig; // Passed from outside
}
```

### State Channels

Each field has a reducer that determines how state updates:

- **projectId**: Uses new value if provided
- **rawText**: Replaces with new value
- **requirements**: Replaces with new value
- **tickets**: Replaces with new array
- **cost**: Accumulates across nodes
- **error**: Propagates errors
- **externalTicketsContext**: Set by readExternal node
- **integrationConfig**: Passed through unchanged

---

## Integration Flow

### Configuration Flow

1. **User Configures Integration** (Frontend)
   - User selects Jira or Linear
   - Enters credentials (API key, email/token, etc.)
   - Enters project mapping (project key, team ID, etc.)
   - Optionally tests connection via `/api/integrations/test`

2. **Save Configuration** (Frontend → API)
   - POST `/api/integrations/config`
   - Saves to `data/integrations/{projectId}.json`
   - Validates schema before saving

3. **Early Configuration** (During Generation)
   - If integration configured before document upload:
     - Project ID created early
     - Config saved immediately
     - Passed to agent workflow

### Reading External Tickets

1. **During Agent Workflow** (`readExternal` node)
   - Checks for `integrationConfig` in state
   - If not present, loads from `projectId`
   - Calls `readExternalTickets(config)`

2. **Fetching Tickets**
   - **Jira**: Uses Jira REST API to fetch issues
   - **Linear**: Uses Linear GraphQL API to fetch issues
   - Returns up to 100 tickets as `ExternalTicket[]`

3. **Formatting Context**
   - `formatExternalTicketsAsContext()` formats tickets:

     ```
     ================================================================================
     EXISTING TICKETS FROM EXTERNAL PROJECT MANAGEMENT TOOL (N tickets):
     ================================================================================

     1. [ID] Title
        Description: ...
        Status: ...
        Priority: ...
        Labels: ...

     ...

     ================================================================================
     IMPORTANT: When generating new tickets, avoid duplicating the above existing tickets.
     If a new ticket depends on an existing one, reference it by its ID.
     ================================================================================
     ```

4. **Including in LLM Prompt**
   - Context prepended to user prompt in `generateTicketsForFeatures()`
   - Appears before requirements
   - Included in every batch

### Pushing Tickets to External Systems

1. **User Initiates Push** (Frontend)
   - User selects tickets (or all)
   - Clicks "Push to Jira/Linear"
   - POST `/api/integrations/push`

2. **Push Process** (`pushTicketsToExternal()`)
   - Loads project and integration config
   - Filters tickets if specific IDs provided
   - For each ticket:
     - Maps ticket to external format (Jira issue or Linear issue)
     - Creates issue in external system
     - Saves mapping: `externalMappings[ticket.id] = externalKey`
   - Updates project file with mappings
   - Returns results per ticket

3. **Mapping Storage**
   - Stored in `ProjectState.externalMappings`
   - Format: `{ [ticketId]: externalIssueKey }`
   - Used to prevent duplicate pushes

---

## Data Persistence

### Project Storage

**Location**: `data/projects/{projectId}.json`

**Structure**: `ProjectState`

```typescript
{
  id: string;
  rawText: string;
  requirements: Requirements;
  tickets: Ticket[];
  cost: { tokensIn, tokensOut, usd };
  createdAt: string;
  updatedAt: string;
  externalMappings?: { [ticketId]: externalKey };
}
```

### Integration Config Storage

**Location**: `data/integrations/{projectId}.json`

**Structure**: `IntegrationConfig`

```typescript
{
  type: "jira" | "linear";
  credentials: JiraCredentials | LinearCredentials;
  projectMapping: {
    externalProjectKey: string;
    externalProjectName?: string;
    teamId?: string;        // Linear only
    projectId?: string;      // Linear only
  };
}
```

### Embeddings Storage

**Location**: `data/embeddings/{projectId}.json`

**Structure**: Array of `TicketEmbedding`

```typescript
[
  {
    ticketId: string;
    projectId: string;
    embedding: number[];  // 1536 dimensions
    text: string;
    createdAt: string;
  }
]
```

---

## Key Components

### Frontend Components

1. **`page.tsx`**: Main application component
   - Manages application state
   - Handles streaming responses
   - Coordinates between components

2. **`Upload.tsx`**: Document upload/paste interface
   - File upload (PDF, text)
   - Text paste
   - Triggers generation

3. **`TicketsBoard.tsx`**: Displays generated tickets
   - Kanban-style board
   - Ticket details
   - Edit/delete actions

4. **`ChatEditor.tsx`**: Natural language ticket editor
   - Chat interface
   - Sends edit instructions
   - Shows edit results

5. **`IntegrationConfig.tsx`**: Integration configuration modal
   - Jira/Linear form
   - Credential input
   - Project mapping

6. **`IntegrationStatus.tsx`**: Shows integration status
   - Displays configured integration
   - Allows reconfiguration

7. **`PushToIntegration.tsx`**: Push tickets to external system
   - Ticket selection
   - Push action
   - Results display

8. **`ProjectHistory.tsx`**: List of past projects
   - Project cards
   - Load project action

### Agent Tools

1. **`parseDocument.ts`**: Extracts text from PDFs or uses pasted text
2. **`security.ts`**: Security checks and sanitization
3. **`extractRequirements.ts`**: LLM-based requirement extraction
4. **`generateTickets.ts`**: LLM-based ticket generation (batched)
5. **`validateTickets.ts`**: Validates tickets against requirements
6. **`persistProject.ts`**: Saves/loads projects
7. **`readExternalTickets.ts`**: Fetches tickets from Jira/Linear
8. **`pushToExternal.ts`**: Pushes tickets to Jira/Linear
9. **`integrationConfig.ts`**: Manages integration configurations
10. **`costTracker.ts`**: Tracks LLM API costs
11. **`ragSearch.ts`**: Semantic search for similar projects
12. **`embeddingService.ts`**: Generates and manages ticket embeddings

### Integration Clients

1. **`jiraClient.ts`**: Jira API client
   - `readJiraIssues()`: Fetch issues
   - `createJiraIssue()`: Create issue
   - `testJiraConnection()`: Test connection

2. **`linearClient.ts`**: Linear API client
   - `readLinearIssues()`: Fetch issues
   - `createLinearIssue()`: Create issue
   - `resolveTeamId()`: Resolve team identifier

---

## Error Handling

### Agent Workflow Errors

- **Security Check Failure**: Returns error in state, stops workflow
- **LLM Errors**: Caught and returned as error in state
- **External Ticket Reading**: Optional, logs warning, continues
- **Validation Issues**: Logged but doesn't fail workflow
- **Embedding Generation**: Optional, logs warning, continues

### API Errors

- All API routes use try/catch
- Return appropriate HTTP status codes
- Include error messages in response
- Log errors to console

### Frontend Errors

- Displayed in error state
- Streaming errors caught and displayed
- User can retry operations

---

## Streaming Architecture

The application uses Server-Sent Events (SSE) for real-time progress updates:

1. **Frontend**: Opens EventSource or uses fetch with streaming
2. **API Route**: Creates TransformStream
3. **Agent**: Calls `onStream` callback with events
4. **Events**: `status`, `progress`, `error`, `complete`
5. **Frontend**: Updates UI based on event type

### Event Types

- **`status`**: Status message (e.g., "Parsing document...")
- **`progress`**: Progress update with optional data
- **`error`**: Error message
- **`complete`**: Final result with full ProjectState

---

## Cost Tracking

Cost tracking is integrated throughout:

1. **Initialization**: `initCostTracker()` called at start
2. **Tracking**: Each LLM call tracks tokens via `tracker.track()`
3. **Accumulation**: Costs accumulated across all nodes
4. **Storage**: Final cost saved in ProjectState
5. **Display**: Frontend shows cost in CostMeter component

---

## Summary

Sprintify is a sophisticated application that:

1. Accepts documents or text input
2. Extracts requirements using LLM
3. Generates structured tickets in batches
4. Integrates with Jira/Linear for context and export
5. Provides real-time streaming updates
6. Supports natural language editing
7. Tracks costs and manages embeddings

The architecture is modular, with clear separation between frontend, API, and agent logic, making it maintainable and extensible.
