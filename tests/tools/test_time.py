import unittest
from datetime import datetime
from unittest.mock import MagicMock

from src.tools.time import TimeTool, SystemTimeProvider, TimeProvider
from src.tools.errors import ProviderUnavailableError

class TestTimeTool(unittest.TestCase):
    def setUp(self):
        self.provider = SystemTimeProvider()
        self.tool = TimeTool(self.provider)

    def test_successful_execution(self):
        dt = self.tool.get_current_datetime()
        self.assertIsInstance(dt, datetime)

        tz = self.tool.get_timezone()
        self.assertIsInstance(tz, str)
        self.assertTrue(len(tz) > 0)

    def test_provider_unavailable(self):
        mock_provider = MagicMock(spec=TimeProvider)
        mock_provider.get_current_datetime.side_effect = ProviderUnavailableError()
        tool = TimeTool(mock_provider)

        with self.assertRaises(ProviderUnavailableError):
            tool.get_current_datetime()

if __name__ == '__main__':
    unittest.main()
