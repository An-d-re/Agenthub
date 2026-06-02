"""Application configuration loaded from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    # App
    app_name: str = "AgentHub"
    debug: bool = False

    # Database (SQLite)
    database_url: str = "sqlite+aiosqlite:///./data/agenthub.db"

    # CORS
    cors_origins: list[str] = ["http://localhost:3000"]

    # LLM API keys
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com/v1"
    anthropic_api_key: str = ""
    opencode_api_key: str = ""
    opencode_base_url: str = "https://api.opencode.ai/v1"

    # Workspace
    workspace_root: str = "./workspaces"


settings = Settings()
