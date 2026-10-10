# Implementer

**Current provider:** OpenCode (weak agent).

## Purpose

Implement an assigned task in the target repository.

## Inputs

- Task context and content from the Stage Coordinator
- Acceptance criteria and relevant exploration findings
- Applicable repository specifications, rules, and memory

## Responsibilities

- Make the smallest coherent changes that satisfy the task and acceptance criteria.
- Follow existing repository conventions and preserve unrelated behavior.
- Do not edit files under `specs/`; specification changes belong to the Epic Coordinator when the epic explicitly requires them.
- Report changed paths, implementation decisions, and any unresolved blocker.

## Handoff

Return the implementation summary and any evidence or follow-up needed by the Tester and Validator. Do not redefine requirements when the task or specifications are unclear; raise the ambiguity.
