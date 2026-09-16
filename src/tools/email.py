from abc import ABC, abstractmethod
from typing import List, Optional
from datetime import datetime

from src.tools.models import EmailMessage

class EmailProvider(ABC):
    @abstractmethod
    def search_messages(self, query: str) -> List[EmailMessage]:
        pass

    @abstractmethod
    def read_message(self, message_id: str) -> EmailMessage:
        pass

    @abstractmethod
    def create_draft(self, to: List[str], subject: str, body: str) -> EmailMessage:
        pass

    @abstractmethod
    def send_message(self, to: List[str], subject: str, body: str) -> bool:
        pass

class EmailTool:
    def __init__(self, provider: EmailProvider):
        self._provider = provider

    def search_messages(self, query: str) -> List[EmailMessage]:
        return self._provider.search_messages(query)

    def read_message(self, message_id: str) -> EmailMessage:
        return self._provider.read_message(message_id)

    def create_draft(self, to: List[str], subject: str, body: str) -> EmailMessage:
        return self._provider.create_draft(to, subject, body)

    def send_message(self, to: List[str], subject: str, body: str) -> bool:
        return self._provider.send_message(to, subject, body)

class StubEmailProvider(EmailProvider):
    def __init__(self):
        self.messages: List[EmailMessage] = []
        self.drafts: List[EmailMessage] = []

    def search_messages(self, query: str) -> List[EmailMessage]:
        # Simple search logic for stub
        return [m for m in self.messages if query.lower() in m.subject.lower() or query.lower() in m.body.lower()]

    def read_message(self, message_id: str) -> EmailMessage:
        for m in self.messages + self.drafts:
            if m.id == message_id:
                m.is_read = True
                return m
        raise ValueError(f"Message {message_id} not found")

    def create_draft(self, to: List[str], subject: str, body: str) -> EmailMessage:
        draft = EmailMessage(
            id=f"draft_{len(self.drafts) + 1}",
            subject=subject,
            sender="me@stub.local",
            recipients=to,
            body=body,
            received_time=datetime.now(),
            is_read=True
        )
        self.drafts.append(draft)
        return draft

    def send_message(self, to: List[str], subject: str, body: str) -> bool:
        message = EmailMessage(
            id=f"sent_{len(self.messages) + 1}",
            subject=subject,
            sender="me@stub.local",
            recipients=to,
            body=body,
            received_time=datetime.now(),
            is_read=True
        )
        self.messages.append(message)
        return True
