using System.Text.Json;

namespace VoiceRelay.Windows;

internal sealed class DuplicateStore
{
    private const int MaxEntries = 1_000;
    private const long MaxAgeMs = 24L * 60 * 60 * 1_000;
    private readonly string _path;
    private readonly object _gate = new();
    private List<DuplicateEntry> _entries;

    public DuplicateStore(string dataDirectory)
    {
        _path = Path.Combine(dataDirectory, "processed-messages.json");
        _entries = Load();
        Prune();
    }

    public bool Contains(string messageId)
    {
        lock (_gate)
        {
            Prune();
            return _entries.Any(entry => entry.MessageId == messageId);
        }
    }

    public void Add(string messageId)
    {
        lock (_gate)
        {
            if (_entries.Any(entry => entry.MessageId == messageId)) return;
            _entries.Add(new DuplicateEntry(messageId, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
            Prune();
            var temporaryPath = _path + ".tmp";
            File.WriteAllText(temporaryPath, JsonSerializer.Serialize(_entries));
            File.Move(temporaryPath, _path, true);
        }
    }

    private List<DuplicateEntry> Load()
    {
        try
        {
            return File.Exists(_path)
                ? JsonSerializer.Deserialize<List<DuplicateEntry>>(File.ReadAllText(_path)) ?? []
                : [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private void Prune()
    {
        var cutoff = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - MaxAgeMs;
        _entries = _entries.Where(entry => entry.ProcessedAt >= cutoff)
            .OrderByDescending(entry => entry.ProcessedAt)
            .Take(MaxEntries)
            .ToList();
    }
}

