import unittest
from datetime import datetime
from unittest.mock import MagicMock

from src.tools.files import FilesTool, StubFilesProvider, FilesProvider
from src.tools.models import FileInfo
from src.tools.errors import ProviderUnavailableError, CredentialsError, MalformedResponseError, TimeoutError, PermissionError

class TestFilesTool(unittest.TestCase):
    def setUp(self):
        self.provider = StubFilesProvider()
        self.tool = FilesTool(self.provider)

        # Setup some stub data
        file_info = FileInfo(id="1", name="test.txt", path="/docs/test.txt", size_bytes=10, modified_time=datetime.now())
        self.provider._add_stub_file(file_info, b"hello")

    def test_successful_execution(self):
        files = self.tool.list_files("/docs")
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].name, "test.txt")

        content = self.tool.read_file("/docs/test.txt")
        self.assertEqual(content, b"hello")

        search_results = self.tool.search_files("test")
        self.assertEqual(len(search_results), 1)

        renamed = self.tool.rename_file("/docs/test.txt", "new.txt")
        self.assertEqual(renamed.name, "new.txt")

        moved = self.tool.move_file("/docs/new.txt", "/archive/new.txt")
        self.assertEqual(moved.path, "/archive/new.txt")

    def test_tool_returning_no_results(self):
        files = self.tool.list_files("/empty")
        self.assertEqual(len(files), 0)

        search_results = self.tool.search_files("nonexistent")
        self.assertEqual(len(search_results), 0)

    def test_provider_unavailable(self):
        mock_provider = MagicMock(spec=FilesProvider)
        mock_provider.list_files.side_effect = ProviderUnavailableError()
        tool = FilesTool(mock_provider)

        with self.assertRaises(ProviderUnavailableError):
            tool.list_files("/")

    def test_credentials_error(self):
        mock_provider = MagicMock(spec=FilesProvider)
        mock_provider.list_files.side_effect = CredentialsError()
        tool = FilesTool(mock_provider)

        with self.assertRaises(CredentialsError):
            tool.list_files("/")

    def test_malformed_response(self):
        mock_provider = MagicMock(spec=FilesProvider)
        mock_provider.list_files.side_effect = MalformedResponseError()
        tool = FilesTool(mock_provider)

        with self.assertRaises(MalformedResponseError):
            tool.list_files("/")

    def test_timeout(self):
        mock_provider = MagicMock(spec=FilesProvider)
        mock_provider.list_files.side_effect = TimeoutError()
        tool = FilesTool(mock_provider)

        with self.assertRaises(TimeoutError):
            tool.list_files("/")

    def test_permission_failure(self):
        mock_provider = MagicMock(spec=FilesProvider)
        mock_provider.list_files.side_effect = PermissionError()
        tool = FilesTool(mock_provider)

        with self.assertRaises(PermissionError):
            tool.list_files("/")

if __name__ == '__main__':
    unittest.main()
