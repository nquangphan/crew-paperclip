// Fixture cố ý chứa chữ cứng; chỉ test/guards dùng, không đưa vào src.
function Hint(_: { description: string; message: string; body: string; hint: string }) {
  return null;
}

export function Hardcoded() {
  return (
    <div>
      <p>Xin chào</p>
      <input placeholder="Tìm" />
      <span>Crew</span>
      <Hint description="Mô tả" message="Lỗi" body="Nội dung" hint="Gợi ý" />
    </div>
  );
}
