"""Run with python3 -m unittest discover -s deploy -p 'test_*.py'."""
import io
from pathlib import Path
import runpy
import tarfile
import tempfile
import unittest

extract = runpy.run_path(str(Path(__file__).with_name('cor-update.py')))['extract']


class ReleaseArchiveTests(unittest.TestCase):
    def archive(self, name, kind=tarfile.REGTYPE, link=''):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        path = root / 'release.tar'
        with tarfile.open(path, 'w') as output:
            entry = tarfile.TarInfo(name)
            entry.type = kind
            entry.linkname = link
            entry.size = 2 if kind == tarfile.REGTYPE else 0
            output.addfile(entry, io.BytesIO(b'ok') if entry.size else None)
        target = root / 'release'
        target.mkdir()
        return path, target

    def test_normal_release(self):
        archive, target = self.archive('server/index.ts')
        extract(archive, target)
        self.assertEqual((target / 'server/index.ts').read_text(), 'ok')

    def test_traversal_is_rejected(self):
        with self.assertRaises(tarfile.FilterError):
            extract(*self.archive('../escape'))

    def test_external_symlink_is_rejected(self):
        with self.assertRaises(tarfile.FilterError):
            extract(*self.archive('link', tarfile.SYMTYPE, '/etc/cor/cor.env'))

    def test_devices_are_rejected(self):
        with self.assertRaises(ValueError):
            extract(*self.archive('device', tarfile.CHRTYPE))

    def test_credentials_are_rejected(self):
        with self.assertRaises(ValueError):
            extract(*self.archive('.env'))
