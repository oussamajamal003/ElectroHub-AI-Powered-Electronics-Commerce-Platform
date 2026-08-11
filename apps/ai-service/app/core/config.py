from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "ElectroHub AI Service"
    ENVIRONMENT: str = "development"
    
    # URL of the backend (allowed origin for CORS)
    BACKEND_URL: str = "http://localhost:5000"
    
    # Future settings: model paths, database urls, etc.
    
    class Config:
        env_file = ".env"
        case_sensitive = True

settings = Settings()
