class ToolError(Exception):
    """Base class for all tool errors."""
    pass

class ProviderUnavailableError(ToolError):
    """Raised when the underlying provider is unavailable or down."""
    pass

class CredentialsError(ToolError):
    """Raised when authentication fails due to missing, expired, or invalid credentials."""
    pass

class MalformedResponseError(ToolError):
    """Raised when the provider returns a response that cannot be parsed."""
    pass

class TimeoutError(ToolError):
    """Raised when a request to the provider times out."""
    pass

class PermissionError(ToolError):
    """Raised when the caller lacks permission to perform the requested action."""
    pass
