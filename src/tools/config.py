import os
from typing import Optional

class Config:
    @staticmethod
    def get(key: str, default: Optional[str] = None) -> Optional[str]:
        """Safely fetch an environment variable."""
        return os.environ.get(key, default)

    @staticmethod
    def require(key: str) -> str:
        """Fetch an environment variable or raise an error if not present."""
        value = os.environ.get(key)
        if value is None:
            raise ValueError(f"Required environment variable '{key}' is missing.")
        return value

# Example usage for specific integrations
class ProviderConfig:
    @property
    def todoist_token(self) -> Optional[str]:
        return Config.get('TODOIST_TOKEN')

    @property
    def microsoft_client_id(self) -> Optional[str]:
        return Config.get('MICROSOFT_CLIENT_ID')

    @property
    def microsoft_client_secret(self) -> Optional[str]:
        return Config.get('MICROSOFT_CLIENT_SECRET')

    @property
    def google_client_id(self) -> Optional[str]:
        return Config.get('GOOGLE_CLIENT_ID')

    @property
    def google_client_secret(self) -> Optional[str]:
        return Config.get('GOOGLE_CLIENT_SECRET')
