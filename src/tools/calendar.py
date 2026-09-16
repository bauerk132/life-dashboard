from abc import ABC, abstractmethod
from typing import List, Optional
from datetime import datetime

from src.tools.models import Event, FreeBusyInfo

class CalendarProvider(ABC):
    @abstractmethod
    def get_events(self, start_time: datetime, end_time: datetime) -> List[Event]:
        pass

    @abstractmethod
    def get_free_busy(self, start_time: datetime, end_time: datetime) -> List[FreeBusyInfo]:
        pass

    @abstractmethod
    def create_event(self, title: str, start_time: datetime, end_time: datetime, description: Optional[str] = None, location: Optional[str] = None, attendees: Optional[List[str]] = None) -> Event:
        pass

    @abstractmethod
    def update_event(self, event_id: str, title: Optional[str] = None, start_time: Optional[datetime] = None, end_time: Optional[datetime] = None, description: Optional[str] = None, location: Optional[str] = None, attendees: Optional[List[str]] = None) -> Event:
        pass

    @abstractmethod
    def delete_event(self, event_id: str) -> bool:
        pass

    @abstractmethod
    def find_available_time(self, start_time: datetime, end_time: datetime, duration_minutes: int) -> List[FreeBusyInfo]:
        pass

class CalendarTool:
    def __init__(self, provider: CalendarProvider):
        self._provider = provider

    def get_events(self, start_time: datetime, end_time: datetime) -> List[Event]:
        return self._provider.get_events(start_time, end_time)

    def get_free_busy(self, start_time: datetime, end_time: datetime) -> List[FreeBusyInfo]:
        return self._provider.get_free_busy(start_time, end_time)

    def create_event(self, title: str, start_time: datetime, end_time: datetime, description: Optional[str] = None, location: Optional[str] = None, attendees: Optional[List[str]] = None) -> Event:
        return self._provider.create_event(title, start_time, end_time, description, location, attendees)

    def update_event(self, event_id: str, title: Optional[str] = None, start_time: Optional[datetime] = None, end_time: Optional[datetime] = None, description: Optional[str] = None, location: Optional[str] = None, attendees: Optional[List[str]] = None) -> Event:
        return self._provider.update_event(event_id, title, start_time, end_time, description, location, attendees)

    def delete_event(self, event_id: str) -> bool:
        return self._provider.delete_event(event_id)

    def find_available_time(self, start_time: datetime, end_time: datetime, duration_minutes: int) -> List[FreeBusyInfo]:
        return self._provider.find_available_time(start_time, end_time, duration_minutes)


class StubCalendarProvider(CalendarProvider):
    def __init__(self):
        self.events: List[Event] = []

    def get_events(self, start_time: datetime, end_time: datetime) -> List[Event]:
        return [e for e in self.events if e.start_time >= start_time and e.end_time <= end_time]

    def get_free_busy(self, start_time: datetime, end_time: datetime) -> List[FreeBusyInfo]:
        # Simple stub logic: mark everything where there's an event as busy
        events_in_range = self.get_events(start_time, end_time)
        return [FreeBusyInfo(start_time=e.start_time, end_time=e.end_time, status='busy') for e in events_in_range]

    def create_event(self, title: str, start_time: datetime, end_time: datetime, description: Optional[str] = None, location: Optional[str] = None, attendees: Optional[List[str]] = None) -> Event:
        new_event = Event(
            id=str(len(self.events) + 1),
            title=title,
            start_time=start_time,
            end_time=end_time,
            description=description,
            location=location,
            attendees=attendees
        )
        self.events.append(new_event)
        return new_event

    def update_event(self, event_id: str, title: Optional[str] = None, start_time: Optional[datetime] = None, end_time: Optional[datetime] = None, description: Optional[str] = None, location: Optional[str] = None, attendees: Optional[List[str]] = None) -> Event:
        for e in self.events:
            if e.id == event_id:
                if title is not None:
                    e.title = title
                if start_time is not None:
                    e.start_time = start_time
                if end_time is not None:
                    e.end_time = end_time
                if description is not None:
                    e.description = description
                if location is not None:
                    e.location = location
                if attendees is not None:
                    e.attendees = attendees
                return e
        raise ValueError(f"Event {event_id} not found")

    def delete_event(self, event_id: str) -> bool:
        for i, e in enumerate(self.events):
            if e.id == event_id:
                del self.events[i]
                return True
        return False

    def find_available_time(self, start_time: datetime, end_time: datetime, duration_minutes: int) -> List[FreeBusyInfo]:
        # Very naive implementation for stub
        return [FreeBusyInfo(start_time=start_time, end_time=end_time, status='free')]
