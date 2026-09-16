from dataclasses import dataclass
from typing import List, Optional, Any
from datetime import datetime

# Tasks
@dataclass
class Task:
    id: str
    title: str
    description: Optional[str] = None
    due_date: Optional[datetime] = None
    completed: bool = False
    parent_id: Optional[str] = None

# Calendar
@dataclass
class Event:
    id: str
    title: str
    start_time: datetime
    end_time: datetime
    description: Optional[str] = None
    location: Optional[str] = None
    attendees: Optional[List[str]] = None

@dataclass
class FreeBusyInfo:
    start_time: datetime
    end_time: datetime
    status: str  # 'free' or 'busy'

# Email
@dataclass
class EmailMessage:
    id: str
    subject: str
    sender: str
    recipients: List[str]
    body: str
    received_time: datetime
    is_read: bool = False

# Files
@dataclass
class FileInfo:
    id: str
    name: str
    path: str
    size_bytes: int
    modified_time: datetime
    is_directory: bool = False

# Time
@dataclass
class TimeInfo:
    current_datetime: datetime
    timezone: str
