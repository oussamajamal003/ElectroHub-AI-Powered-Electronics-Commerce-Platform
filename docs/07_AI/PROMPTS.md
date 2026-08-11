# AI Prompts

## 1. Purpose

This document defines the prompt strategy for AI-assisted functionality in ElectroHub.

Prompts are only required where the implemented AI workflow uses a language model or prompt-based processing.

Image similarity and deterministic recommendation algorithms do not require LLM prompts.

---

# 2. Prompt Principles

All prompts must be:

- Explicit.
- Deterministic where practical.
- Versioned.
- Testable.
- Minimal.
- Free of unnecessary personal information.

Prompts must not contain:

```text
Passwords
OTP Values
Payment Credentials
JWTs
Refresh Tokens
API Keys
Database Credentials
```

---

# 3. Prompt Versioning

Prompts should have identifiable versions.

Example:

```text
recommendation-v1
recommendation-v2
```

When a prompt changes in a behaviorally significant way, the change should be documented.

---

# 4. Recommendation Prompt

If an LLM is used for recommendation reasoning, the prompt should provide only the necessary context.

Conceptual input:

```text
Current Product
Product Category
Allowed Candidate Products
User Preference Signals
Recommendation Mode
```

The model should return structured candidate references rather than uncontrolled prose.

---

# 5. Recommendation Prompt Contract

Conceptually:

```text
SYSTEM:
You are a product recommendation assistant for an electronics store.

TASK:
Rank the provided candidate products for the current shopping context.

RULES:
- Only select products from the provided candidate list.
- Do not invent product IDs.
- Do not invent prices or inventory.
- Return structured JSON.
- Do not expose private user information.
```

The exact prompt is implementation-specific and must be versioned when used.

---

# 6. Structured Output

AI responses should use a strict schema where possible.

Example:

```json
{
  "recommendations": [
    {
      "productId": "product-id",
      "reason": "compatible category",
      "score": 0.88
    }
  ]
}
```

The backend must validate this response before using it.

---

# 7. Image Search Prompts

A conventional image-similarity model does not require a text prompt.

If an LLM-assisted image classifier is introduced, it may receive structured instructions such as:

```text
Identify the likely electronics product category in the supplied image.

Return only:
{
  "category": "...",
  "confidence": 0.0
}
```

The result must be treated as a candidate signal, not authoritative catalog truth.

---

# 8. Product Grounding

AI prompts must be grounded in application-provided data.

Do not allow a model to invent:

```text
Product IDs
Prices
Stock Quantities
Payment Status
Order Status
Shipping Status
```

The backend/database remains authoritative.

---

# 9. Prompt Injection

User-provided text or metadata may contain malicious instructions.

AI workflows must treat customer-controlled content as untrusted input.

The system should:

```text
Separate Instructions from Data
 ↓
Limit Available Context
 ↓
Validate Structured Output
 ↓
Verify Product References
```

AI output must never directly execute application actions.

---

# 10. Recommendation Safety

The model must not be allowed to:

```text
Modify Orders
Modify Payments
Modify Inventory
Create Admin Accounts
Change Permissions
Access Secrets
```

Recommendation AI is an advisory component.

The backend controls actual application state.

---

# 11. Prompt Input Minimization

Only send information required for the recommendation.

Prefer:

```text
Product IDs
Categories
Non-sensitive Preferences
Aggregated Behavior
```

Avoid sending unnecessary:

```text
Email Addresses
Phone Numbers
Addresses
Authentication Tokens
Payment Information
```

---

# 12. Deterministic Alternative

Where an LLM provides limited value, prefer deterministic recommendation logic.

Examples:

```text
Category Matching
Purchase Frequency
Co-Purchase Frequency
Popularity
Product Compatibility
```

This reduces:

```text
Cost
Latency
Complexity
Hallucination Risk
```

---

# 13. Simulated Academic Mode

The project may simulate AI behavior for portfolio demonstration.

Example:

```text
User Behavior
 ↓
Rule-Based Score
 ↓
Recommendation Result
```

This should be clearly documented as simulated/rule-based functionality.

---

# 14. Prompt Testing

Prompt-based functionality should be tested with:

```text
Normal Input
Empty Input
Invalid Input
Unexpected Product IDs
Conflicting Context
Malicious Instructions
Very Large Input
No Candidate Products
```

The backend must validate the final output regardless of prompt quality.

---

# 15. Prompt Observability

Where appropriate, record non-sensitive metadata such as:

```text
Prompt Version
Model Version
Processing Duration
Success / Failure
Result Count
```

Do not log full sensitive prompts or user data unnecessarily.

---

# 16. Prompt Changes

Prompt changes that affect customer-visible recommendations should be treated as behavioral changes.

Review:

```text
Prompt
Output Schema
Tests
Model Version
Fallback
Documentation
```

before release.

---

# 17. External AI Providers

If an external LLM provider is introduced, credentials must be stored in environment variables.

Never commit:

```text
API Keys
Provider Secrets
Tokens
```

The external provider must be documented in the relevant architecture/ADR when it becomes a required dependency.

---

# 18. Definition of Done

Prompt-based AI functionality is complete when:

- Prompts are versioned.
- Inputs are minimized.
- Structured outputs are validated.
- Product references are backend-validated.
- Prompt injection risks are considered.
- Sensitive data is excluded.
- Fallback behavior exists.
- Tests cover invalid and adversarial inputs.
- Model/prompt versions are traceable.
- Documentation matches implementation.

---

# 19. Prompt Principle

> **Prompts are controlled application inputs, not trusted business logic: every AI result must be structured, validated, grounded in approved data, and ultimately controlled by the backend.**
