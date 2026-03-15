# conana-bot Updated Agent Architecture Task Plan

## Overview

This document describes the updated task plan to evolve **conana-bot**
into a scalable **agent-based system**.

Current architecture:

Telegram ↓ n8n workflow ↓ HTTP ↓ opencode-proxy ↓ opencode run ↓
response

Target architecture:

Telegram ↓ n8n workflow ↓ Intent Router ↓ Agent Runtime API ↓ Planner ↓
Tool Execution ↓ OpenCode ↓ Response

Key improvements:

-   LLM intent routing
-   agent runtime abstraction
-   tool execution layer
-   improved n8n workflow
-   optional memory support
-   future queue system

# Phase 1 --- Router Layer

## Goal

Replace command-only routing with **hybrid routing** using an LLM
router.

Command routing remains for deterministic behavior.

Natural language messages are routed using **Gemini Flash**.

## Tasks

-   [ ] Create router service
-   [ ] Implement `/router/intent` endpoint
-   [ ] Call Gemini Flash for intent classification
-   [ ] Add router service to docker-compose
-   [ ] Update n8n workflow to call router

## Router API

POST /router/intent

Example request:

{ "message": "write a blog post about ai agents" }

Example response:

{ "intent": "blog" }

Supported intents:

blog\
email\
qa\
stock\
automation\
general

# Phase 2 --- Agent Runtime

Current proxy:

opencode-proxy.js

This should evolve into a structured **agent runtime service**.

## Tasks

-   [ ] Create `services/agent`
-   [ ] Implement executor
-   [ ] Implement planner
-   [ ] Move opencode-proxy into services/opencode

## Agent API

POST /agent/run

Example:

{ "intent": "blog", "input": "AI agent architecture" }

Flow:

input\
↓\
planner\
↓\
tool selection\
↓\
opencode run\
↓\
return response

# Phase 3 --- Tool Layer

Introduce tool abstraction so the agent can use multiple capabilities.

## Tasks

-   [ ] Create `services/agent/tools`
-   [ ] Implement blog writer tool
-   [ ] Implement email writer tool
-   [ ] Implement QA tool
-   [ ] Implement web search tool
-   [ ] Implement stock analysis tool

Example tool metadata:

{ "name": "blog_writer", "description": "write blog post",
"input_schema": { "topic": "string" } }

# Phase 4 --- n8n Workflow Refactor

Current workflow:

Telegram Trigger ↓ command parser ↓ HTTP → opencode ↓ Telegram response

## New Workflow

Telegram Trigger ↓ Normalize Message ↓ Check Command ↓ IF Command ├
command flow └ Router API ↓ Intent Switch ↓ Agent API ↓ Format Response
↓ Telegram Send

## Recommended Node Layout

Telegram Trigger\
↓\
Set Node (normalize message)\
↓\
IF Node (startsWith "/")\
↓\
HTTP Router\
↓\
Switch Node (intent)\
↓\
HTTP Agent\
↓\
Set Response\
↓\
Telegram Send

# Phase 5 --- Memory Layer (Optional)

Add persistent memory.

Recommended storage:

Redis

Stored fields:

user_id\
conversation history\
context

Usage:

context injection into agent prompt

# Phase 6 --- Queue System (Future)

Current flow:

n8n → opencode

Issues:

-   long tasks
-   concurrency
-   reliability

Future solution:

Redis + BullMQ

Architecture:

n8n\
↓\
queue\
↓\
agent worker

# Phase 7 --- Multi-Agent (Future)

Possible agents:

writing-agent\
research-agent\
automation-agent\
coding-agent

Router maps intent → agent.

# Updated Priority Tasks

## Immediate

-   [ ] Router service
-   [ ] n8n router integration
-   [ ] Hybrid routing logic

## Next

-   [ ] Agent runtime service
-   [ ] Executor implementation

## Later

-   [ ] Tool registry
-   [ ] Blog/email/search tools

## Future

-   [ ] Memory layer
-   [ ] Queue system
-   [ ] Multi-agent support

# Expected Outcome

Current system:

workflow bot

Future system:

agent platform

Capabilities:

-   natural language routing
-   agent planning
-   tool-based execution
-   scalable architecture
-   extensible agent ecosystem
