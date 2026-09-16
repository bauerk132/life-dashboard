from abc import ABC, abstractmethod
from typing import List, Optional
from datetime import datetime

from src.tools.models import Task

class TaskProvider(ABC):
    @abstractmethod
    def get_tasks(self) -> List[Task]:
        pass

    @abstractmethod
    def get_tasks_for_date(self, date: datetime) -> List[Task]:
        pass

    @abstractmethod
    def create_task(self, title: str, description: Optional[str] = None, due_date: Optional[datetime] = None) -> Task:
        pass

    @abstractmethod
    def create_subtask(self, parent_id: str, title: str, description: Optional[str] = None, due_date: Optional[datetime] = None) -> Task:
        pass

    @abstractmethod
    def update_task(self, task_id: str, title: Optional[str] = None, description: Optional[str] = None, due_date: Optional[datetime] = None) -> Task:
        pass

    @abstractmethod
    def complete_task(self, task_id: str) -> Task:
        pass

    @abstractmethod
    def reschedule_task(self, task_id: str, new_due_date: datetime) -> Task:
        pass


class TaskTool:
    def __init__(self, provider: TaskProvider):
        self._provider = provider

    def get_tasks(self) -> List[Task]:
        return self._provider.get_tasks()

    def get_tasks_for_date(self, date: datetime) -> List[Task]:
        return self._provider.get_tasks_for_date(date)

    def create_task(self, title: str, description: Optional[str] = None, due_date: Optional[datetime] = None) -> Task:
        return self._provider.create_task(title, description, due_date)

    def create_subtask(self, parent_id: str, title: str, description: Optional[str] = None, due_date: Optional[datetime] = None) -> Task:
        return self._provider.create_subtask(parent_id, title, description, due_date)

    def update_task(self, task_id: str, title: Optional[str] = None, description: Optional[str] = None, due_date: Optional[datetime] = None) -> Task:
        return self._provider.update_task(task_id, title, description, due_date)

    def complete_task(self, task_id: str) -> Task:
        return self._provider.complete_task(task_id)

    def reschedule_task(self, task_id: str, new_due_date: datetime) -> Task:
        return self._provider.reschedule_task(task_id, new_due_date)


class StubTaskProvider(TaskProvider):
    def __init__(self):
        self.tasks: List[Task] = []

    def get_tasks(self) -> List[Task]:
        return self.tasks

    def get_tasks_for_date(self, date: datetime) -> List[Task]:
        return [t for t in self.tasks if t.due_date and t.due_date.date() == date.date()]

    def create_task(self, title: str, description: Optional[str] = None, due_date: Optional[datetime] = None) -> Task:
        new_task = Task(
            id=str(len(self.tasks) + 1),
            title=title,
            description=description,
            due_date=due_date
        )
        self.tasks.append(new_task)
        return new_task

    def create_subtask(self, parent_id: str, title: str, description: Optional[str] = None, due_date: Optional[datetime] = None) -> Task:
        new_task = Task(
            id=str(len(self.tasks) + 1),
            title=title,
            description=description,
            due_date=due_date,
            parent_id=parent_id
        )
        self.tasks.append(new_task)
        return new_task

    def update_task(self, task_id: str, title: Optional[str] = None, description: Optional[str] = None, due_date: Optional[datetime] = None) -> Task:
        for t in self.tasks:
            if t.id == task_id:
                if title is not None:
                    t.title = title
                if description is not None:
                    t.description = description
                if due_date is not None:
                    t.due_date = due_date
                return t
        raise ValueError(f"Task {task_id} not found")

    def complete_task(self, task_id: str) -> Task:
        for t in self.tasks:
            if t.id == task_id:
                t.completed = True
                return t
        raise ValueError(f"Task {task_id} not found")

    def reschedule_task(self, task_id: str, new_due_date: datetime) -> Task:
        for t in self.tasks:
            if t.id == task_id:
                t.due_date = new_due_date
                return t
        raise ValueError(f"Task {task_id} not found")
