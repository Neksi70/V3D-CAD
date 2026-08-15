namespace VolmeThin.Core;

/// <summary>Nur-Lese-Sicht auf einen Ausschnitt eines seekbaren Streams.</summary>
public sealed class SubStream : Stream
{
    private readonly Stream _inner;
    private readonly long _offset;
    private readonly long _length;
    private long _pos;

    public SubStream(Stream inner, long offset, long length)
    {
        if (!inner.CanSeek) throw new ArgumentException("Stream muss seekbar sein.", nameof(inner));
        _inner = inner; _offset = offset; _length = length;
    }

    public override bool CanRead => true;
    public override bool CanSeek => true;
    public override bool CanWrite => false;
    public override long Length => _length;

    public override long Position
    {
        get => _pos;
        set => _pos = Math.Clamp(value, 0, _length);
    }

    public override int Read(byte[] buffer, int offset, int count)
    {
        if (_pos >= _length) return 0;
        int want = (int)Math.Min(count, _length - _pos);
        _inner.Position = _offset + _pos;
        int got = _inner.Read(buffer, offset, want);
        _pos += got;
        return got;
    }

    public override long Seek(long offset, SeekOrigin origin) => Position = origin switch
    {
        SeekOrigin.Begin => offset,
        SeekOrigin.Current => _pos + offset,
        SeekOrigin.End => _length + offset,
        _ => throw new ArgumentOutOfRangeException(nameof(origin))
    };

    public override void Flush() { }
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    protected override void Dispose(bool disposing)
    {
        if (disposing) _inner.Dispose();
        base.Dispose(disposing);
    }
}
