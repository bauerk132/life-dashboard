import unittest
from datetime import datetime, timedelta
from unittest.mock import MagicMock

from src.tools.calendar import CalendarTool, StubCalendarProvider, CalendarProvider
from src.tools.errors import ProviderUnavailableError, CredentialsError, MalformedResponseError, TimeoutError, PermissionError

class TestCalendarTool(unittest.TestCase):
    def setUp(self):
        self.provider = StubCalendarProvider()
        self.tool = CalendarTool(self.provider)

    def test_successful_execution(self):
        start = datetime(2023, 10, 1, 10, 0)
        end = datetime(2023, 10, 1, 11, 0)

        event = self.tool.create_event(title="Meeting", start_time=start, end_time=end)
        self.assertEqual(event.title, "Meeting")

        events = self.tool.get_events(datetime(2023, 10, 1), datetime(2023, 10, 2))
        self.assertEqual(len(events), 1)

        updated = self.tool.update_event(event.id, title="Updated Meeting")
        self.assertEqual(updated.title, "Updated Meeting")

        deleted = self.tool.delete_event(event.id)
        self.assertTrue(deleted)

    def test_tool_returning_no_results(self):
        events = self.tool.get_events(datetime.now(), datetime.now() + timedelta(days=1))
        self.assertEqual(len(events), 0)

    def test_provider_unavailable(self):
        mock_provider = MagicMock(spec=CalendarProvider)
        mock_provider.get_events.side_effect = ProviderUnavailableError()
        tool = CalendarTool(mock_provider)

        with self.assertRaises(ProviderUnavailableError):
            tool.get_events(datetime.now(), datetime.now())

    def test_credentials_error(self):
        mock_provider = MagicMock(spec=CalendarProvider)
        mock_provider.get_events.side_effect = CredentialsError()
        tool = CalendarTool(mock_provider)

        with self.assertRaises(CredentialsError):
            tool.get_events(datetime.now(), datetime.now())

    def test_malformed_response(self):
        mock_provider = MagicMock(spec=CalendarProvider)
        mock_provider.get_events.side_effect = MalformedResponseError()
        tool = CalendarTool(mock_provider)

        with self.assertRaises(MalformedResponseError):
            tool.get_events(datetime.now(), datetime.now())

    def test_timeout(self):
        mock_provider = MagicMock(spec=CalendarProvider)
        mock_provider.get_events.side_effect = TimeoutError()
        tool = CalendarTool(mock_provider)

        with self.assertRaises(TimeoutError):
            tool.get_events(datetime.now(), datetime.now())

    def test_permission_failure(self):
        mock_provider = MagicMock(spec=CalendarProvider)
        mock_provider.get_events.side_effect = PermissionError()
        tool = CalendarTool(mock_provider)

        with self.assertRaises(PermissionError):
            tool.get_events(datetime.now(), datetime.now())

if __name__ == '__main__':
    unittest.main()
