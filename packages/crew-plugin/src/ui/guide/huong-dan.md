# Hướng dẫn sử dụng 2P Crew

2P Crew giao việc lập trình cho một đội agent AI, chạy Claude Code trên Mac mini. Bạn chỉ cần viết yêu cầu bằng một câu. Agent tự chia việc, viết code, review, ghi docs và đẩy lên `main`. Bạn chỉ cần duyệt ở bước cuối.

Trang này giải thích từng phần bạn sẽ thấy trên màn hình: dùng để làm gì, khi nào cần bạn ra tay, và gặp sự cố thì làm gì.

---

## 1. Hệ thống gồm những gì

| Thành phần | Ở đâu | Làm gì |
|---|---|---|
| **Web Crew** (Paperclip) | `https://crew.2p-solutions.com`, chạy trên VPS | Nơi bạn tạo yêu cầu, theo dõi tiến độ, duyệt kết quả |
| **Plugin Crew** | Nằm trong web | Thêm luật làm việc của Crew: 4 bước duyệt, kiểm docs, tách gói việc, chọn model. Thêm cả các màn hình Crew: tóm tắt, map, trang Crew, widget máy |
| **Mac mini** | Ở nhà, kết nối với VPS qua Tailscale | Nơi agent thật sự chạy. Code của bạn cũng nằm trên máy này |
| **crew-mac** | Cài trên Mac mini | Cài đặt và kiểm máy, mỗi phút gửi tình trạng máy lên web, chụp docs của repo gửi lên web |

Dữ liệu gồm issue, bình luận và lịch sử run nằm trên VPS, được backup tự động lúc 03:30 hằng ngày. Code nằm trong repo git trên Mac. Agent chỉ đẩy lên `main` sau khi bạn duyệt.

---

## 2. Đăng nhập

- Vào `https://crew.2p-solutions.com`, đăng nhập bằng email và mật khẩu của bạn.
- Trang đăng nhập có dòng "Create one", nhưng **không tạo được tài khoản mới**: đăng ký tự do đã tắt để người lạ không vào được. Muốn thêm người thì nhờ Trợ Lý tạo.
- Bản Paperclip này chưa có màn hình đổi mật khẩu. Muốn đổi thì nhờ Trợ Lý.
- Nếu trang cứ quay "đang tải" mãi: tải lại trang hoặc mở tab ẩn danh. Thường là trình duyệt còn giữ phiên đăng nhập cũ, từ hồi domain này còn chạy bản Crew cũ.

---

## 3. Các agent trong đội

| Agent | Vai trò |
|---|---|
| **Trợ Lý** (`tro-ly`) | Nhận yêu cầu của bạn, đọc docs dự án, hỏi lại khi thiếu thông tin. Sau đó chia thành các việc con, chọn model cho từng việc rồi giao cho executor. Khi mọi việc con xong, Trợ Lý tổng kết lại |
| **Executor** (`mac-claude`, `mac-claude-2`) | Viết code cho từng việc con: test trước, code sau, commit lên nhánh riêng. Hai executor chạy song song được |
| **Reviewer** | Đọc diff, chạy test, duyệt hoặc trả về để sửa. Mỗi việc được trả về tối đa 5 vòng |
| **Integrator** | Gộp các việc con, chạy kiểm docs (`crew-docs check`) trên commit đã gộp. Sau khi bạn duyệt thì đẩy lên `main` |

Agent dùng model Claude theo độ khó của việc: Sonnet cho việc nhỏ và vừa, Opus cho việc lớn. Trợ Lý tự chọn, ghi trong mỗi việc con bằng dòng `crew-model`.

---

## 4. Giao một yêu cầu

1. Bấm **New Task**, ở trên cùng thanh bên trái.
2. Viết tiêu đề ngắn và phần mô tả. Mô tả nên nói rõ:
   - **muốn gì**, ví dụ: "Thêm nút xuất Excel ở trang báo cáo";
   - **ở repo nào hoặc phần nào**, nếu có nhiều dự án;
   - **cái gì không được đụng**, nếu có.
3. Giao (Assignee) cho **Trợ Lý**.
4. Lưu lại. Phần còn lại tự chạy.

**Ba loại yêu cầu:**
- **Code** (mặc định): đi đủ 4 bước duyệt ở mục 6.
- **Bug**: tả triệu chứng, ví dụ "bấm X thì ra Y, đúng ra phải ra Z". Executor sẽ tìm nguyên nhân trước, viết test bắt được lỗi rồi mới sửa.
- **Nghiên cứu**: gắn nhãn **`research`** khi tạo, ví dụ "So sánh hai cách lưu cache, đề xuất một". Agent chỉ viết báo cáo, không sửa code và không đẩy gì lên. Loại này chỉ có 2 bước duyệt: reviewer rồi tới bạn.

**Viết thế nào cho Trợ Lý làm tốt:**
- Một yêu cầu, một mục tiêu. Hai mục tiêu không liên quan thì tách làm hai yêu cầu.
- Nếu Trợ Lý thiếu thông tin, nó sẽ **hỏi lại bạn** (xem mục 5). Bạn không cần viết dài từ đầu.

---

## 5. Khi Trợ Lý hỏi lại

Nếu yêu cầu chưa rõ, ví dụ "thêm lời chào theo ngôn ngữ" nhưng không nói ngôn ngữ nào, Trợ Lý sẽ:
- tạo một **thẻ câu hỏi** ngay trong yêu cầu, có sẵn lựa chọn và ô "Khác" để bạn tự gõ;
- chuyển yêu cầu sang **Blocked**, nghĩa là đang chờ bạn.

Bạn mở yêu cầu đó, chọn hoặc gõ câu trả lời rồi gửi. Trợ Lý tự chạy tiếp, không hỏi lại câu đã trả lời.

Mục **Inbox** (thanh bên trái, có số đếm) gom mọi thứ đang chờ bạn: câu hỏi, việc cần duyệt.

---

## 6. Luồng 4 bước của một yêu cầu code

```
Bạn tạo yêu cầu → Trợ Lý chia việc → executor làm từng việc con → reviewer duyệt từng con
                                                                       ↓
   (4) Integrator đẩy lên main ← (3) BẠN DUYỆT ← (2) Integrator gộp + kiểm docs ← (1) Reviewer duyệt cả yêu cầu
```

| Bước | Ai | Nội dung |
|---|---|---|
| 1. Reviewer | agent | Kiểm mọi việc con đã xong và đúng yêu cầu gốc |
| 2. Integrator · gộp + docs | agent | Gộp code vào một nhánh, chạy test, chạy `crew-docs check`. Docs sai thì không cho qua |
| 3. **Owner duyệt** | **bạn** | Xem kết quả rồi duyệt hoặc yêu cầu sửa |
| 4. Integrator · đẩy | agent | Đẩy commit lên `main`, ghi dòng `crew-merge … pushed=yes` |

**Cách duyệt ở bước 3:**
- Vào **Inbox**. Mục cần duyệt có nút **Approve** (đồng ý) và **Request changes** (trả về sửa), chữ tiếng Anh của Paperclip.
- Trước khi duyệt nên xem:
  - dòng `crew-docs-check … exit=0`, nghĩa là docs đạt;
  - các bình luận của reviewer;
  - map trong phần tóm tắt Crew của yêu cầu (mục 7).
- Bấm **Approve** thì integrator tự đẩy lên `main`. Bấm **Request changes** và ghi lý do thì việc quay lại để sửa.

**Vòng sửa:** mỗi lần reviewer trả về là một vòng. Sau 5 vòng mà vẫn chưa đạt, việc sẽ được chuyển cho bạn quyết.

---

## 7. Màn hình Crew

### 7.1 Tóm tắt Crew trong một yêu cầu

Mở một yêu cầu Crew, ngay đầu luồng hội thoại có một dòng như:

> **Crew · 2/3 con xong · Integrator · gộp + docs · docs Đạt**

- **x/y con xong**: số việc con đã xong trên tổng số việc con.
- **Bước hiện tại**: Reviewer, Integrator · gộp + docs, Owner duyệt, Integrator · đẩy, hoặc Đã xong.
- **docs**: kết quả kiểm docs mới nhất của integrator.
  - *Đạt*: docs khớp code.
  - *Lỗi*: docs sai, integrator phải sửa.
  - *Không hợp lệ*: dòng bằng chứng sai định dạng.
  - *Chưa có*: chưa tới bước kiểm docs.

Bấm **Mở map** để xem sơ đồ:
- **Ô**: yêu cầu gốc và từng việc con. Mỗi ô có mã (CRE-…), tiêu đề, trạng thái, bước hiện tại và số vòng sửa.
- **Đường cha-con**: yêu cầu gốc nối tới việc con.
- **Đường phụ thuộc** ("phải xong trước"): việc A phải xong thì việc B mới chạy.
- **Đường sửa**: nối việc bị trả về với việc sửa nó, có ghi số vòng.

Nếu yêu cầu không phải của Crew thì không có dòng tóm tắt này.

### 7.2 Trang Crew

Bấm **Crew** trong mục plugin ở thanh bên trái, hoặc vào `/<mã-công-ty>/crew`. Trang có 3 mục.

**Yêu cầu.** Mọi yêu cầu Crew đang mở, mới nhất ở trên, kèm số việc con xong/tổng và bước hiện tại. Bấm vào một dòng để mở yêu cầu đó.

**Máy.** Mỗi Mac chạy agent là một thẻ:
- **Trực tuyến / Mất liên lạc**: Mac gửi tin mỗi 60 giây. Quá 3 phút không nhận được tin thì báo *Mất liên lạc*, có ghi "lần cuối …".
- **Tải 1 phút / số CPU**: máy bận tới đâu. Khi tải vượt ngưỡng (hiện là 8), agent chờ máy rảnh rồi mới chạy, để không làm đơ máy.
- **RAM trống**: phần trăm bộ nhớ còn trống.
- **Biểu đồ tải 24 giờ**.
- **Hộp thoại quyền macOS đang chờ (TCC)**: hiện màu cảnh báo. Có dòng này nghĩa là agent đang bị macOS chặn. Xem cách xử lý ở mục 9.
- **Claude**: phiên bản, đã đăng nhập chưa, gói nào.
- **Superpowers**: bản ghim cho agent và bản bạn đang cài. Hai bản nên giống nhau.
- **Các mục kiểm lỗi hoặc cảnh báo** từ `crew-mac doctor`.
- Ô nào hiện "Không rõ" nghĩa là lần đó Mac không đọc được giá trị ấy. Không phải lỗi web.

**Docs.** Cây docs của từng repo, Mac gửi lên mỗi khi `main` có commit mới:
- chọn **Dự án** ở ô chọn;
- dòng trạng thái: repo, commit, giờ nhận, *Đã xác minh* (docs đạt) hoặc *Không hợp lệ*;
- bấm trang trong cây để đọc;
- **Liên kết** ở cuối trang: link bấm được, hoặc ghi "— thiếu trang" nếu link trỏ tới trang không tồn tại;
- **Tìm kiếm**: gõ từ khóa rồi Enter;
- file nào có dấu hiệu chứa mật khẩu hay token thì **không được gửi lên** và hiện trong danh sách "đã bỏ".

### 7.3 Widget trên Dashboard

Ô nhỏ trên Dashboard cho biết nhanh máy nào đang trực tuyến.

---

## 8. Các dòng `crew-…` trong bình luận

Agent dùng các dòng có quy ước sẵn để báo cho nhau và cho hệ thống. Bạn không cần viết chúng, chỉ cần đọc hiểu.

| Dòng | Ý nghĩa |
|---|---|
| `crew-plan root=… children=… bundles=…` | Kế hoạch của Trợ Lý: số việc con, số gói |
| `crew-bundle id=… seq=…` | Việc con thuộc gói nào, thứ tự mấy. Các việc cùng gói do một executor làm lần lượt và **dùng chung trí nhớ (session)**, nên đỡ tốn thời gian đọc lại code |
| `crew-model complexity=… model=… effort=…` | Độ khó và model Trợ Lý chọn cho việc con |
| `crew-stack on=CRE-…` | Việc này xây tiếp trên code của việc kia |
| `crew-kind research` | Việc nghiên cứu, không sửa code |
| `crew-review … verdict=approved` | Reviewer đã duyệt |
| `crew-docs-check commit=… exit=0` | Integrator kiểm docs trên commit đã gộp. `exit=0` là đạt |
| `crew-merge sha=… pushed=yes` | Đã đẩy lên `main` |
| `crew-assistant done children=…` | Trợ Lý xác nhận mọi việc con đã xong |

---

## 9. Sự cố thường gặp

| Bạn thấy | Nguyên nhân | Cách xử lý |
|---|---|---|
| Thẻ máy báo **hộp thoại TCC đang chờ** | Claude Code trên Mac vừa tự cập nhật, macOS hỏi quyền | Mở màn hình Mac mini (trực tiếp hoặc qua Chrome Remote Desktop), tìm hộp thoại có tên phiên bản Claude (ví dụ "2.1.294") rồi bấm **Allow**. Không thấy hộp thoại thì vào System Settings → Privacy & Security → Files and Folders, bật quyền cho Claude |
| Máy **Mất liên lạc** | Mac tắt, mất mạng, hoặc job gửi trạng thái bị dừng | Kiểm Mac mini còn bật và có mạng. Trên Mac chạy `crew-mac doctor` |
| Việc đứng ở **Đang chờ** lâu | Máy đang quá tải (tải 1 phút > 8), agent chờ máy rảnh. Chờ quá 60 phút thì việc báo lỗi | Đóng bớt app nặng trên Mac (emulator, simulator…) |
| Yêu cầu **Blocked** | Đang chờ bạn trả lời câu hỏi, hoặc đang chờ việc con | Mở yêu cầu xem thẻ câu hỏi, hoặc xem trong Inbox |
| docs **Lỗi** | Code đổi mà docs chưa sửa theo | Integrator tự tạo việc sửa. Nếu lặp lại nhiều lần thì nhờ Trợ Lý xem |
| Agent báo hết quota | Gói Claude trên Mac đã dùng hết hạn mức | Chờ hạn mức mở lại. Quota này dùng chung với Claude Code của bạn trên Mac |
| Trang tải mãi | Phiên đăng nhập cũ trong trình duyệt | Tải lại trang, mở tab ẩn danh, đăng nhập lại |

---

## 10. Vận hành (để biết)

- **Backup:** VPS backup DB và dữ liệu lúc 03:30 hằng ngày, kèm backup trước mỗi lần cập nhật. Restore được diễn tập định kỳ trên bản sao cách ly.
- **Cập nhật:** mỗi bản mới đều có backup và mốc quay lại. Hỏng thì quay về bản trước trong vài phút.
- **Nâng Paperclip:** phần Crew chỉ cắm vào Paperclip qua 5 điểm nối một dòng, nên nâng lên bản Paperclip mới không phải viết lại.
- **Bảo mật:**
  - đăng ký tự do đã tắt;
  - tình trạng máy và docs gửi lên đều có chữ ký, web từ chối bản tin không có chữ ký đúng;
  - file nghi chứa mật khẩu hay token không bao giờ được gửi lên;
  - credential AI chỉ nằm trên Mac.

---

## 11. Thuật ngữ

| Từ | Nghĩa |
|---|---|
| Yêu cầu gốc | Issue bạn tạo và giao cho Trợ Lý |
| Việc con | Issue Trợ Lý tách ra từ yêu cầu gốc |
| Gói (bundle) | Nhóm việc con cùng một vùng code, do một executor làm lần lượt |
| Run | Một lần agent chạy để làm một việc |
| Stage / bước | Một bước duyệt trong luồng 4 bước |
| Vòng sửa | Một lần reviewer trả việc về sửa |
| Session | Trí nhớ làm việc của agent. Việc cùng gói dùng lại session của việc trước |
| TCC | Hệ thống xin quyền truy cập của macOS |
| Cổng tải | Luật chờ máy rảnh rồi mới cho agent chạy |
