import unittest
from unittest.mock import MagicMock

from src.tools.email import EmailTool, StubEmailProvider, EmailProvider
from src.tools.errors import ProviderUnavailableError, CredentialsError, MalformedResponseError, TimeoutError, PermissionError

class TestEmailTool(unittest.TestCase):
    def setUp(self):
        self.provider = StubEmailProvider()
        self.tool = EmailTool(self.provider)

    def test_successful_execution(self):
        draft = self.tool.create_draft(["test@example.com"], "Draft Sub", "Body")
        self.assertEqual(draft.subject, "Draft Sub")

        sent = self.tool.send_message(["test@example.com"], "Sub", "Body")
        self.assertTrue(sent)

        messages = self.tool.search_messages("Sub")
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0].subject, "Sub")

        read_msg = self.tool.read_message(messages[0].id)
        self.assertTrue(read_msg.is_read)

    def test_tool_returning_no_results(self):
        messages = self.tool.search_messages("nonexistent")
        self.assertEqual(len(messages), 0)

    def test_provider_unavailable(self):
        mock_provider = MagicMock(spec=EmailProvider)
        mock_provider.search_messages.side_effect = ProviderUnavailableError()
        tool = EmailTool(mock_provider)

        with self.assertRaises(ProviderUnavailableError):
            tool.search_messages("q")

    def test_credentials_error(self):
        mock_provider = MagicMock(spec=EmailProvider)
        mock_provider.search_messages.side_effect = CredentialsError()
        tool = EmailTool(mock_provider)

        with self.assertRaises(CredentialsError):
            tool.search_messages("q")

    def test_malformed_response(self):
        mock_provider = MagicMock(spec=EmailProvider)
        mock_provider.search_messages.side_effect = MalformedResponseError()
        tool = EmailTool(mock_provider)

        with self.assertRaises(MalformedResponseError):
            tool.search_messages("q")

    def test_timeout(self):
        mock_provider = MagicMock(spec=EmailProvider)
        mock_provider.search_messages.side_effect = TimeoutError()
        tool = EmailTool(mock_provider)

        with self.assertRaises(TimeoutError):
            tool.search_messages("q")

    def test_permission_failure(self):
        mock_provider = MagicMock(spec=EmailProvider)
        mock_provider.search_messages.side_effect = PermissionError()
        tool = EmailTool(mock_provider)

        with self.assertRaises(PermissionError):
            tool.search_messages("q")

if __name__ == '__main__':
    unittest.main()
