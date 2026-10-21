# AI Prompts

## 1. Purpose and Current Applicability

Phase 04 uses a pretrained EfficientNet-B0 CNN fine-tuned in PyTorch, learned embeddings, pgvector retrieval, and embedding-based recommendations. These workflows do not use LLM prompts. No LLM provider, prompt-based classifier, or generated recommendation prose is required for the approved scope.

The remaining prompt guidance is conditional policy for a separately approved future LLM capability. Example prompts are illustrative and inactive; they do not replace the trained encoder or the real ML recommendation requirement. Training settings and preprocessing are versioned model configuration, not LLM prompts.

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

# 7. Image Search Does Not Require Prompts

The approved image path is deterministic inference preprocessing, the fine-tuned EfficientNet-B0 encoder, learned embeddings, and pgvector nearest-neighbor retrieval. Category guesses from a prompted language model are not a substitute for task 04.2.

Any future LLM-assisted image interpretation requires a separate scope/architecture decision and must return validated candidate signals only. It must not become catalog truth or a commerce authority.

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

# 12. Non-LLM Recommendation Architecture

The approved recommender reuses learned product embeddings for content-based retrieval and authorized behavior profiles. Metadata, compatibility rules, co-purchase aggregation, and popularity may supplement ranking or provide explicit fallbacks.

This requires no recommendation prompt or separate external LLM. Do not describe fallback rules as trained-model results, and do not replace the required ML path with simulated prompt responses.

---

# 13. Simulation and Test Fixtures

Mocks may support isolated development and contract tests, but simulated matching and recommendation responses do not satisfy Phase 04 completion. Validate a real fine-tuned checkpoint, compatible persisted embeddings, retrieval, and recommendation integration before claiming the feature is complete.

Quality claims must follow evaluation evidence; neither prompt examples nor plausible demo outputs establish production-grade accuracy.

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

# 18. Conditional Definition of Done

For the current non-LLM scope, document that no runtime prompts/provider are required and verify the actual model, preprocessing, embedding version, retrieval, recommendation, security, and fallback contracts in the companion AI documents.

If a future prompt-based capability is approved, completion requires versioned prompts, minimized inputs, schema-validated outputs, backend-validated product references, injection testing, safe logging, privacy controls, explicit fallbacks, and traceable prompt/model versions. It must not grant authority over commerce state.

---

# 19. Prompt Principle

> **Prompts are controlled application inputs, not trusted business logic: every AI result must be structured, validated, grounded in approved data, and ultimately controlled by the backend.**


See `AI_ARCHITECTURE.md`, `MODEL_FLOW.md`, and `RECOMMENDER.md` for the current training, embedding lifecycle, FastAPI, data access, and operational security boundaries. Task 04.1 establishes service architecture; Kaggle Free GPU setup and training occur later in task 04.2 on approved data, with HP local development. Detailed implementation belongs in task files.
