from abc import ABC, abstractmethod
from typing import List, Optional
from datetime import datetime

from src.tools.models import FileInfo

class FilesProvider(ABC):
    @abstractmethod
    def list_files(self, directory_path: str) -> List[FileInfo]:
        pass

    @abstractmethod
    def read_file(self, file_path: str) -> bytes:
        pass

    @abstractmethod
    def search_files(self, query: str) -> List[FileInfo]:
        pass

    @abstractmethod
    def move_file(self, source_path: str, destination_path: str) -> FileInfo:
        pass

    @abstractmethod
    def rename_file(self, file_path: str, new_name: str) -> FileInfo:
        pass

class FilesTool:
    def __init__(self, provider: FilesProvider):
        self._provider = provider

    def list_files(self, directory_path: str) -> List[FileInfo]:
        return self._provider.list_files(directory_path)

    def read_file(self, file_path: str) -> bytes:
        return self._provider.read_file(file_path)

    def search_files(self, query: str) -> List[FileInfo]:
        return self._provider.search_files(query)

    def move_file(self, source_path: str, destination_path: str) -> FileInfo:
        return self._provider.move_file(source_path, destination_path)

    def rename_file(self, file_path: str, new_name: str) -> FileInfo:
        return self._provider.rename_file(file_path, new_name)

class StubFilesProvider(FilesProvider):
    def __init__(self):
        self.files: dict[str, dict] = {} # path -> { 'info': FileInfo, 'content': bytes }

    def list_files(self, directory_path: str) -> List[FileInfo]:
        result = []
        for path, data in self.files.items():
            if path.startswith(directory_path) and path != directory_path:
                result.append(data['info'])
        return result

    def read_file(self, file_path: str) -> bytes:
        if file_path not in self.files:
            raise FileNotFoundError(f"File {file_path} not found")
        return self.files[file_path]['content']

    def search_files(self, query: str) -> List[FileInfo]:
        return [data['info'] for data in self.files.values() if query in data['info'].name]

    def move_file(self, source_path: str, destination_path: str) -> FileInfo:
        if source_path not in self.files:
            raise FileNotFoundError(f"File {source_path} not found")

        file_data = self.files.pop(source_path)
        file_info = file_data['info']
        file_info.path = destination_path

        # simple renaming of name if path changes (assuming last part is name)
        file_info.name = destination_path.split('/')[-1]

        self.files[destination_path] = file_data
        return file_info

    def rename_file(self, file_path: str, new_name: str) -> FileInfo:
        if file_path not in self.files:
            raise FileNotFoundError(f"File {file_path} not found")

        file_data = self.files[file_path]
        file_info = file_data['info']
        file_info.name = new_name

        # update path (naive implementation for stub)
        parts = file_path.split('/')
        parts[-1] = new_name
        new_path = '/'.join(parts)
        file_info.path = new_path

        self.files[new_path] = self.files.pop(file_path)
        return file_info

    def _add_stub_file(self, file_info: FileInfo, content: bytes):
        self.files[file_info.path] = {'info': file_info, 'content': content}
