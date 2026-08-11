from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import health
from app.core.config import settings

app = FastAPI(
    title=settings.PROJECT_NAME,
    version="0.1.0",
    description="AI Service for ElectroHub — Image Search and Recommendations",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.BACKEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health.router, tags=["Health"])

@app.on_event("startup")
async def startup_event():
    # Initialize models or connections here in future phases
    pass
