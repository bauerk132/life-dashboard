import unittest
from datetime import datetime
from unittest.mock import MagicMock

from src.tools.tasks import TaskTool, StubTaskProvider, TaskProvider
from src.tools.errors import ProviderUnavailableError, CredentialsError, MalformedResponseError, TimeoutError, PermissionError

class TestTasksTool(unittest.TestCase):
    def setUp(self):
        self.provider = StubTaskProvider()
        self.tool = TaskTool(self.provider)

    def test_successful_execution(self):
        task = self.tool.create_task(title="Test Task")
        self.assertEqual(task.title, "Test Task")

        tasks = self.tool.get_tasks()
        self.assertEqual(len(tasks), 1)

        updated = self.tool.update_task(task.id, title="Updated Task")
        self.assertEqual(updated.title, "Updated Task")

        completed = self.tool.complete_task(task.id)
        self.assertTrue(completed.completed)

    def test_tool_returning_no_results(self):
        tasks = self.tool.get_tasks()
        self.assertEqual(len(tasks), 0)

    def test_provider_unavailable(self):
        mock_provider = MagicMock(spec=TaskProvider)
        mock_provider.get_tasks.side_effect = ProviderUnavailableError("Service down")
        tool = TaskTool(mock_provider)

        with self.assertRaises(ProviderUnavailableError):
            tool.get_tasks()

    def test_credentials_error(self):
        mock_provider = MagicMock(spec=TaskProvider)
        mock_provider.get_tasks.side_effect = CredentialsError("Invalid token")
        tool = TaskTool(mock_provider)

        with self.assertRaises(CredentialsError):
            tool.get_tasks()

    def test_malformed_response(self):
        mock_provider = MagicMock(spec=TaskProvider)
        mock_provider.get_tasks.side_effect = MalformedResponseError("Bad JSON")
        tool = TaskTool(mock_provider)

        with self.assertRaises(MalformedResponseError):
            tool.get_tasks()

    def test_timeout(self):
        mock_provider = MagicMock(spec=TaskProvider)
        mock_provider.get_tasks.side_effect = TimeoutError("Connection timed out")
        tool = TaskTool(mock_provider)

        with self.assertRaises(TimeoutError):
            tool.get_tasks()

    def test_permission_failure(self):
        mock_provider = MagicMock(spec=TaskProvider)
        mock_provider.get_tasks.side_effect = PermissionError("Forbidden")
        tool = TaskTool(mock_provider)

        with self.assertRaises(PermissionError):
            tool.get_tasks()

if __name__ == '__main__':
    unittest.main()
