from abc import ABC, abstractmethod
from datetime import datetime
import time as time_module

from src.tools.models import TimeInfo

class TimeProvider(ABC):
    @abstractmethod
    def get_current_datetime(self) -> datetime:
        pass

    @abstractmethod
    def get_timezone(self) -> str:
        pass

class TimeTool:
    def __init__(self, provider: TimeProvider):
        self._provider = provider

    def get_current_datetime(self) -> datetime:
        return self._provider.get_current_datetime()

    def get_timezone(self) -> str:
        return self._provider.get_timezone()

class SystemTimeProvider(TimeProvider):
    def get_current_datetime(self) -> datetime:
        return datetime.now()

    def get_timezone(self) -> str:
        return time_module.tzname[time_module.daylight]
