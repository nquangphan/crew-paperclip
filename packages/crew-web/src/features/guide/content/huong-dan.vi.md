# Hướng dẫn sử dụng 2P Crew

2P Crew là một đội agent AI biết lập trình. Bạn viết yêu cầu bằng lời, ví dụ "thêm nút xuất Excel ở trang báo cáo". Đội agent tự chia việc, viết code, tự review, cập nhật tài liệu rồi đẩy code lên nhánh chính. Bạn chỉ cần trả lời khi được hỏi và duyệt ở bước cuối.

Hướng dẫn này viết cho người **mới vào lần đầu**, không cần biết lập trình. Đọc từ trên xuống: mục 1 trả lời "tôi có phải cài đặt gì không", mục 2 đến 8 là cách dùng hằng ngày, các mục sau để tra cứu khi cần. Bấm tên mục trong **Mục lục** bên dưới để nhảy tới đó.

## 1. Lần đầu vào: có cần dựng gì không?

**Không cần.** Công ty và các máy đã được dựng sẵn, bạn chỉ cần làm bốn việc: **đăng nhập, giao yêu cầu cho Trợ Lý, trả lời câu hỏi, duyệt kết quả.**

| Thành phần | Là gì |
|---|---|
| **Company** | Không gian làm việc chứa mọi yêu cầu, project và agent. Chọn company ở góc trên thanh bên trái. Danh sách chỉ có company đã được cấu hình cho Crew |
| **Project** | Một repo code mà đội agent làm việc trên đó. Mỗi project có bốn vai trò: Trợ Lý, Executor (người viết code, 1 hoặc 2 người), Reviewer (người kiểm tra), Integrator (người gộp code và đẩy lên) |
| **Agent** | Mỗi vai trò do một agent đảm nhận. Agent chạy Claude Code trên máy Mac của bạn |
| **Máy** | Máy Mac chạy agent. Máy phải bật, có mạng và có app 2P Crew đang chạy |
| **Luật làm việc** | Mỗi yêu cầu code đi qua các bước duyệt cố định, có kiểm tài liệu tự động và tối đa 5 vòng sửa |

Muốn đưa **một repo mới** cho đội làm, dùng nút **Thêm project** ở trang [Project](/projects) (xem mục 8). Muốn thêm một người viết code, dùng nút **Tạo agent** ở trang [Agent](/agents) (xem mục 9). Cả hai đều ngay trên web, không cần gõ lệnh.

## 2. Đăng nhập, đổi ngôn ngữ, đăng xuất

{{shot:login}}

1. Mở địa chỉ Crew mà người quản trị gửi cho bạn.
2. Nhập **Email** và **Mật khẩu** rồi bấm **Đăng nhập**.
3. Đăng nhập xong bạn vào trang **Tổng quan**.

Lưu ý:
- **Không có nút tạo tài khoản.** Đăng ký tự do đã tắt để người lạ không vào được. Tài khoản do người quản trị cấp.
- Sai email hoặc mật khẩu thì trang báo "Sai email hoặc mật khẩu". Nhập lại là được.
- Đổi ngôn ngữ Việt hoặc Anh ở trang [Cài đặt](/settings), mục **Ngôn ngữ**. Lựa chọn được nhớ trong trình duyệt này.
- Đăng xuất: bấm **Tài khoản** ở thanh bên trái rồi chọn **Đăng xuất**.
- Khi một ứng dụng trên máy Mac xin đăng nhập, trình duyệt mở trang **Cho phép ứng dụng đăng nhập**. Chỉ bấm **Cho phép** nếu chính bạn vừa bật ứng dụng đó. Không chắc thì bấm **Hủy**.

## 3. Làm quen màn hình chính

{{shot:dashboard}}

**Thanh bên trái**, từ trên xuống:
- **Yêu cầu mới**: mở hộp thoại tạo yêu cầu. Đây là nút dùng nhiều nhất.
- **Tìm kiếm**: tìm yêu cầu và tài liệu. Có thể bấm Ctrl+K (hoặc Cmd+K trên Mac), gõ mã yêu cầu như `TPS-12` rồi Enter để mở nhanh.
- **Tổng quan**: số agent đang chạy hoặc tạm dừng, số yêu cầu đang mở, số yêu cầu **chờ bạn duyệt**, các run gần đây và thẻ máy.
- **Hộp thư**: những thứ đang chờ bạn. Con số bên cạnh là số mục chưa đọc.
- **Yêu cầu**: toàn bộ yêu cầu của company, yêu cầu con nằm dưới yêu cầu gốc.
- **Project**, **Agent**: danh sách và tình trạng sẵn sàng (mục 10).
- **Skills**, **Máy**, **Docs**: mục 11, 12 và 13.
- **Hướng dẫn**: trang bạn đang đọc.
- **Cài đặt**: hồ sơ, ngôn ngữ, thông tin hệ thống.

Giao diện tự cập nhật: khi agent làm xong một bước, trạng thái trên trang đổi theo, bạn không cần tải lại.

## 4. Giao một yêu cầu

{{shot:new-issue}}

1. Bấm **Yêu cầu mới** ở thanh bên trái.
2. Chọn **Project**. Danh sách chỉ có project đã **sẵn sàng**. Project chưa sẵn sàng thì xem mục 10 để biết còn thiếu gì.
3. Chọn **Loại**: Code, Bug hoặc Nghiên cứu (bảng bên dưới).
4. Viết **Tiêu đề**, ngắn gọn, một câu.
5. Viết **Mô tả**. Nên ghi:
   - **muốn gì** và **vì sao**;
   - **ở chỗ nào**: trang nào, phần nào;
   - **cái gì không được đụng**, nếu có.
6. Có thể **Đính kèm** ảnh hoặc file. File có đuôi lạ sẽ hiện cảnh báo trước khi gửi, bạn vẫn gửi được.
7. Ô **Người nhận** luôn là Trợ Lý của project và không đổi được. Mọi yêu cầu đều đi qua Trợ Lý.
8. Bấm **Tạo**. Nếu chưa muốn đội bắt đầu làm, bấm **Lưu nháp (chưa chạy)**: yêu cầu được lưu nhưng không agent nào chạy.

**Ví dụ một yêu cầu tốt:**

> **Tiêu đề:** Thêm lời chào tiếng Nhật cho greet
>
> **Mô tả:** Hàm `greet` hiện chào được vi và en. Thêm `ja` ("こんにちは"), kèm test. Không đổi kết quả của vi và en.

**Ba loại yêu cầu:**

| Loại | Khi nào | Ghi chú |
|---|---|---|
| **Code** | Thêm hoặc sửa tính năng | Đi đủ các bước duyệt |
| **Bug** | Có lỗi | Mô tả **triệu chứng**: "bấm X thì ra Y, đúng ra phải ra Z". Agent tìm nguyên nhân, viết test bắt được lỗi rồi mới sửa |
| **Nghiên cứu** | Cần so sánh hoặc đề xuất, không sửa code | Chỉ có hai bước duyệt: Reviewer rồi bạn, không đẩy code. Cần company có nhãn "research", nếu chưa có thì hộp thoại báo và không chọn được loại này |

Mẹo: **một yêu cầu, một mục tiêu.** Hai việc không liên quan thì tạo hai yêu cầu. Thiếu thông tin cũng không sao, Trợ Lý sẽ hỏi lại.

## 5. Theo dõi một yêu cầu

### 5.1 Chuyện gì xảy ra sau khi giao

```
Bạn giao cho Trợ Lý
  → Trợ Lý đọc tài liệu project, hỏi lại nếu thiếu thông tin
  → Trợ Lý chia thành các yêu cầu con, chọn model cho từng việc, giao cho Executor
  → Executor viết code (test trước, code sau)  →  Reviewer duyệt từng yêu cầu con
  → khi mọi yêu cầu con xong, yêu cầu gốc đi qua các bước:
     (1) Reviewer  →  (2) Integrator gộp code và kiểm tài liệu  →  (3) BẠN DUYỆT  →  (4) Integrator đẩy code lên nhánh chính
```

Một yêu cầu nhỏ thường mất 15 đến 30 phút, tùy độ khó và độ bận của máy.

### 5.2 Xem tiến độ

{{shot:issue-detail}}

Mở yêu cầu từ trang **Yêu cầu** hoặc **Hộp thư**. Ở trang **Yêu cầu** bạn có thể tìm, lọc theo trạng thái, project, người làm, loại (Nghiên cứu hoặc Code / Bug), sắp xếp, nhóm và chọn cột. Hai cột của Crew:
- **Giai đoạn Crew**: yêu cầu đang ở bước nào.
- **Yêu cầu con**: dạng "1/3 con xong".

Trong trang một yêu cầu, ngay đầu trang có dòng **Tóm tắt Crew**, ví dụ "Crew · 1/1 con xong · docs Đạt":
- **x/y con xong**: số yêu cầu con đã xong trên tổng số.
- **Giai đoạn**: *Reviewer*; *Integrator · merge + docs*; *Owner duyệt* (đang chờ bạn); *Integrator · push*; *Đã xong*.
- **docs**: *Đạt* là tài liệu khớp code; *Lỗi* là Integrator sẽ sửa; *Chưa có* là chưa tới bước kiểm.

Bấm **Mở map** để xem sơ đồ các việc. Mỗi ô là yêu cầu gốc hoặc một yêu cầu con, ghi loại việc, giai đoạn, người đang làm và số vòng sửa (ví dụ 0/5). Nét đứt nối các việc phải xong trước. Bấm **Đóng map** để thu lại. Mở map cũng hiện kết quả **Kiểm docs**.

Bên dưới là **Thuộc tính** (trạng thái, người làm, project, loại, model đang dùng, giai đoạn và người duyệt, vòng sửa) và **Bình luận**: agent ghi lại từng bước ở đây, và run đang chạy hiện trực tiếp. Bạn có thể sửa tiêu đề và mô tả, viết bình luận, đính kèm file. Các dòng bình luận bắt đầu bằng `crew-` là bằng chứng máy đọc được, xem mục 16.

### 5.3 Khi Trợ Lý hỏi lại

Nếu yêu cầu chưa rõ, Trợ Lý tạo một **thẻ câu hỏi** ngay trong yêu cầu, tiêu đề "Trợ Lý cần hỏi", có sẵn lựa chọn và ô **Khác** để tự gõ. Yêu cầu chuyển sang **Bị chặn** trong lúc chờ. Bạn chọn đáp án rồi bấm **Gửi trả lời**, Trợ Lý tự chạy tiếp.

Có khi Trợ Lý cần **xác nhận** một việc: thẻ "Trợ Lý cần xác nhận" có hai nút **Đồng ý** và **Từ chối**. Từ chối thì nên ghi lý do vào ô **Lý do (khi từ chối)**.

## 6. Duyệt, yêu cầu sửa, hủy và mở lại

Khi giai đoạn là **Owner duyệt**, đến lượt bạn. Trước hết xem lại:
- bình luận của Reviewer;
- kết quả **Kiểm docs** là Đạt;
- mọi yêu cầu con đã xong.

Rồi chọn một trong các nút ở đầu trang yêu cầu:

| Nút | Dùng khi | Chuyện xảy ra |
|---|---|---|
| **Duyệt** | Đồng ý với kết quả | Hộp thoại hiện ô **Lời nhắn khi duyệt**, đã điền sẵn "Đã xem, duyệt." Bạn sửa tùy ý, **không được để trống**. Bấm xác nhận thì Integrator đẩy code lên nhánh chính và yêu cầu thành **Hoàn thành** |
| **Yêu cầu sửa** | Chưa đồng ý | Viết **Lý do cần sửa** (ít nhất 5 ký tự) rồi **Gửi yêu cầu sửa**. Việc quay về người làm vòng trước và tính thêm một vòng sửa |
| **Hủy yêu cầu** | Không cần nữa | Có hộp xác nhận. Yêu cầu chuyển sang **Đã hủy** và run đang chạy trên máy bị dừng |
| **Mở lại** | Yêu cầu đã hoàn thành hoặc đã hủy mà cần làm lại | Có hộp xác nhận. Yêu cầu về **Cần làm**, các bước chạy lại từ đầu ở vòng mới |

Lưu ý:
- Nút **Duyệt** và **Yêu cầu sửa** chỉ hiện đúng ở bước Owner duyệt, và chỉ với người được giao duyệt.
- Nếu hết 5 vòng sửa mà vẫn chưa đạt, yêu cầu được chuyển cho bạn quyết định. Lúc này bạn trả lời bằng **bình luận** (nói rõ hướng xử lý), không có nút Duyệt.
- Bạn không thể tự đặt trạng thái thành "Hoàn thành". Lý do ở mục 15.
- Run đang chạy hiện nút **Dừng run** (có hộp xác nhận) ở danh sách run của yêu cầu.

## 7. Hộp thư và Tổng quan

{{shot:inbox}}

**Hộp thư** gom mọi thứ đang cần bạn. Các tab:
- **Chờ tôi duyệt**: yêu cầu đang ở bước Owner duyệt và yêu cầu có câu hỏi Trợ Lý chờ bạn trả lời. Duyệt xong thì yêu cầu biến mất khỏi tab này.
- **Của tôi**, **Chưa đọc**, **Đang kẹt**, **Tất cả**: lọc theo nhu cầu.
- Chấm bên trái nghĩa là chưa đọc. Có thể đánh dấu đã đọc hoặc chưa đọc, và **lưu trữ** một mục (mục chỉ rời khỏi Hộp thư, yêu cầu vẫn còn).

**Tổng quan** cho bức tranh chung: thẻ số liệu (agent, yêu cầu, **chờ bạn duyệt**), run gần đây kèm link "Xem run" để đọc nội dung agent đã chạy, thẻ **Máy** và yêu cầu gần đây.

## 8. Thêm một project mới

{{shot:add-project}}

Bấm [Thêm project](/projects/new) ở trang Project. Wizard dựng mọi thứ giúp bạn, **repo git phải có sẵn trên máy Mac** (Crew không tải repo về).

**Điền biểu mẫu:**
1. **Máy**: chọn máy Mac. Máy ghi "App chưa chạy" nghĩa là app 2P Crew chưa mở, các bước trên máy sẽ chờ.
2. **Folder repo trên máy**: đường dẫn đầy đủ tới repo, ví dụ `/Users/ten/code/my-repo`. Các folder đã kiểm trước đây được gợi ý sẵn.
3. **Khóa project**: chữ thường, số, gạch ngang, bắt đầu bằng chữ, 2 đến 31 ký tự. Khóa dùng để đặt tên agent và nhánh. Khóa trùng project đã có sẽ bị từ chối.
4. **Tên project** và **Số executor** (1 hoặc 2).
5. Bấm **Bắt đầu**.

**Wizard tự chạy 7 bước** và hiện từng bước đang chạy, xong hay lỗi:

| Bước | Việc |
|---|---|
| Kiểm folder repo | Máy kiểm folder đúng là repo git |
| Tạo project | Tạo project trong company |
| Tạo checkout cho từng vai trò | Máy dựng thư mục làm việc riêng cho từng vai trò |
| Tạo environment SSH | Cho mỗi vai trò, chép từ environment mẫu của company |
| Tạo agent và AGENTS.md | Mỗi vai trò một agent, kèm hướng dẫn theo vai trò |
| Ghi vai trò | Lưu ai giữ vai trò nào |
| Kiểm trên máy | Máy kiểm lần cuối mọi thứ chạy được |

Một bước lỗi thì wizard **tạm dừng các agent đã tạo**, hiện lỗi và nút **Chạy tiếp**. Bấm là chạy tiếp từ bước dở, không tạo trùng. Đóng trang giữa chừng cũng không sao: ở danh sách Project, project dở có nút **Làm tiếp**. Xong thì bấm **Mở project**.

## 9. Tạo thêm một agent

{{shot:add-agent}}

Bấm [Tạo agent](/agents/new) ở trang Agent, dùng khi cần thêm Executor hoặc thay người giữ vai trò. Wizard có 6 bước:
1. Đặt tên, chọn project, vai trò, model mặc định và máy.
2. Ghim đúng bản Superpowers của máy và ghi `AGENTS.md` theo vai trò.
3. Tạo environment SSH riêng cho agent.
4. Máy dựng thư mục làm việc riêng cho agent.
5. Ghi vai trò của agent trong project.
6. Nếu là Executor: cập nhật `AGENTS.md` của Trợ Lý để Trợ Lý biết có thêm người.

Agent chưa xong 6 bước ở trạng thái **Chưa sẵn sàng** và **không xuất hiện** trong bất kỳ lựa chọn nào. Bấm **Làm tiếp** (ở danh sách hoặc trang agent) để hoàn tất.

Chỉ **người dùng trên web** mới tạo được agent. Agent không tạo được agent khác (xem mục 15).

## 10. Project và Agent: xem, sửa vai trò, sẵn sàng

{{shot:projects}}

Trang [Project](/projects) liệt kê project kèm cột **Sẵn sàng**, số yêu cầu, và nút gắn sao. Bấm một project để xem các tab:
- **Yêu cầu**: yêu cầu của project.
- **Vai trò**: ai giữ vai trò nào. Bấm **Sửa vai trò** để đổi, rồi **Lưu vai trò**. Lưu xong, hướng dẫn `AGENTS.md` của Trợ Lý được cập nhật theo.
- **Docs**: tài liệu project (xem mục 13).
- **Sẵn sàng**: danh sách kiểm. Mục nào chưa đạt có nút **Làm tiếp** dẫn vào wizard.
- **Đổi tên**: tên, mô tả, màu, biểu tượng.

{{shot:agents}}

Trang [Agent](/agents) liệt kê agent kèm vai trò, trạng thái và **Sẵn sàng**. Có thể lọc **Đang chạy**, **Tạm dừng**, **Lỗi**. Nút **Tạm dừng** dừng agent và hủy run đang chạy; **Tiếp tục** cho agent chạy lại. Bấm một agent để xem:
- **Tổng quan**: run gần nhất, yêu cầu đang làm, máy, vai trò, và các mục còn thiếu.
- **Hướng dẫn**: xem `AGENTS.md`, chỉ đọc. Nút **Render lại theo vai trò** ghi lại bản đúng theo vai trò hiện tại. Có người vừa sửa thì báo xung đột và **không ghi đè**, bạn tải lại rồi render lại.
- **Skills**: bật hoặc tắt skill của company cho agent này, hiệu lực từ run kế tiếp.
- **Cấu hình chạy**: xem adapter, lệnh, environment, máy. Chỉ đổi được **Model mặc định**, chọn trong bảng model của Crew.
- **Run**: các lần chạy của agent.

**Sẵn sàng** gồm các kiểm tra: cấu hình agent đúng, ghim đúng Superpowers, `AGENTS.md` khớp vai trò, environment SSH đúng, thư mục làm việc có trên máy, agent đang giữ vai trò. Project **chưa sẵn sàng** thì không có trong hộp thoại Yêu cầu mới.

## 11. Skills

{{shot:skills}}

Trang [Skills](/skills) liệt kê skill của company (khả năng bổ sung cho agent), nguồn, số agent đang dùng và trạng thái đã đồng bộ lên mấy máy.

**Thêm skill:** bấm **Thêm skill**, dán địa chỉ repo GitHub (có thể thêm nhánh hoặc tag), bấm **Quét repo**, chọn skill muốn thêm, có thể **Xem trước**, rồi bấm **Thêm skill**. Skill trùng tên với skill Superpowers mà Crew đã ghim sẽ không thêm được.

Bấm một skill để xem chi tiết, **Bật cho agent** (từng agent một) và xem mục **Đồng bộ lên máy**, cho biết từng máy đã đồng bộ, đang chờ hay lỗi. Có nút **Đồng bộ** hoặc **Đồng bộ lại**. Chữ "Chờ app 2P Crew" nghĩa là app trên máy chưa nhận việc, mở app là xong.

## 12. Máy

{{shot:machines}}

Trang [Máy](/machines) có một thẻ cho mỗi máy Mac chạy agent, tự làm mới mỗi 30 giây:
- **Trực tuyến / Mất liên lạc**: máy gửi tin mỗi phút. Quá 3 phút không có tin thì báo mất liên lạc.
- **Tải 1 phút / số CPU** và **RAM trống**, kèm biểu đồ tải 24 giờ. Tải vượt 8 thì agent **chờ** máy rảnh rồi mới chạy, để không làm đơ máy.
- **TCC đang chờ**: macOS đang hỏi quyền mà chưa ai bấm. Agent bị chặn cho tới khi có người bấm **Cho phép** trên màn hình Mac.
- **Claude**: phiên bản, đã đăng nhập chưa, gói nào. **Superpowers**: bản ghim và bản của owner.
- **App 2P Crew**: phiên bản và trạng thái cập nhật.
- Chữ **Không rõ** nghĩa là lần này máy không đọc được giá trị đó, chưa chắc là lỗi.

Bên dưới là **Hàng đợi việc trên máy**: các việc máy cần làm (xem thư mục repo, dựng checkout, đồng bộ skill, kiểm tra project) đang **Đang chờ**, **Đang làm** hoặc **Lỗi**. Việc đã xong không hiện. Việc lỗi có nút thử lại.

## 13. Docs

{{shot:docs}}

Trang [Docs](/docs) là tài liệu của từng project, đọc từ bản mới nhất mà máy đã gửi lên (tự cập nhật khi nhánh chính có commit mới):
- chọn project, xem commit và giờ nhận;
- bấm trang trong cây để đọc; link trong trang mở thẳng trang đích, link hỏng ghi "Thiếu trang";
- ô **Tìm trong tài liệu**: gõ từ khóa, ví dụ `greet`;
- file có dấu hiệu chứa mật khẩu hay token **không bao giờ được gửi lên**, chỉ hiện tên trong mục "File bị bỏ do quét bí mật".

Tab **Docs** trong trang một project cho cùng nội dung ngay trong project đó.

## 14. Cài đặt

{{shot:settings}}

Trang [Cài đặt](/settings) có ba mục:
- **Hồ sơ**: sửa **Tên hiển thị** và **Ảnh đại diện** (chọn ảnh mới rồi bấm **Lưu hồ sơ**; có nút **Gỡ ảnh đại diện**).
- **Ngôn ngữ**: Tiếng Việt hoặc Tiếng Anh.
- **Thông tin hệ thống**: bản server, commit đang chạy, sao lưu gần nhất. Chỉ để xem.

## 15. Vì sao không có nút X

Nếu bạn quen Paperclip gốc và tìm không thấy một nút, đa số là cố ý. Có ba lý do chính:
- **Luật bảo vệ luồng duyệt.** Crew có các luật tự động: yêu cầu luôn đi qua Trợ Lý; không thể đặt "Hoàn thành" bằng tay để bỏ qua review, kiểm tài liệu và đẩy code; cấu hình agent không bị sửa tùy ý.
- **Luật phân quyền chặt.** **Agent không tạo được agent khác** và không tự cấp quyền cho mình. **Agent không sửa được project** (vai trò, tên, cài đặt). Việc đó chỉ người dùng làm được trên web, qua các wizard và trang Project, Agent có kiểm tra từng bước.
- **Thay bằng luồng đầy đủ.** Tạo project, tạo agent và thêm skill có wizard riêng thay cho form trơn.

Bảng dưới liệt kê từng tính năng Paperclip không có trong Crew, nằm ở đâu trong Paperclip, vì sao, và cách làm thay thế. Mã lý do: **Crew không dùng**, **Bị luật chặn**, **Chưa có luồng**, **Để bản sau**.

{{missing}}

## 16. Đọc các dòng `crew-…` trong bình luận

| Dòng | Ý nghĩa |
|---|---|
| `crew-plan root=… children=… bundles=…` | Kế hoạch của Trợ Lý: mấy yêu cầu con, mấy gói |
| `crew-bundle id=… seq=…` | Yêu cầu con thuộc gói nào, thứ mấy. Cùng gói thì một Executor làm lần lượt và **nhớ** ngữ cảnh việc trước |
| `crew-model complexity=… model=…` | Độ khó và model được chọn: Sonnet cho việc vừa và nhỏ, Opus cho việc lớn |
| `crew-stack on=TPS-…` | Việc này xây tiếp trên code của việc kia |
| `crew-kind research` | Việc nghiên cứu, không sửa code |
| `crew-review … verdict=approved` | Reviewer đã duyệt |
| `crew-docs-check commit=… exit=0` | Integrator đã kiểm tài liệu trên code đã gộp. `exit=0` là đạt |
| `crew-merge sha=… pushed=yes` | Đã đẩy lên nhánh chính |
| `crew-assistant done children=…` | Trợ Lý xác nhận mọi yêu cầu con đã xong |

## 17. Sự cố thường gặp

| Bạn thấy | Nguyên nhân | Cách xử lý |
|---|---|---|
| Thẻ máy báo **TCC đang chờ** | macOS đang xin quyền cho Claude Code | Mở màn hình Mac, tìm hộp thoại xin quyền và bấm **Cho phép**. Không thấy thì vào System Settings, Privacy & Security, Files and Folders, bật quyền cho Claude |
| Máy **Mất liên lạc** | Mac tắt, mất mạng hoặc app 2P Crew chưa mở | Kiểm Mac còn bật, có mạng, mở lại app 2P Crew |
| Việc trên máy ghi **Chờ app 2P Crew** | App chưa chạy nên chưa nhận việc | Mở app 2P Crew trên Mac |
| Yêu cầu không chạy | Lưu nháp, hoặc Trợ Lý đang tạm dừng | Tạo lại không chọn "Lưu nháp"; kiểm trang [Agent](/agents) xem Trợ Lý có đang **Tạm dừng** không |
| Yêu cầu đứng lâu | Máy quá tải (tải trên 8), agent đang chờ | Đóng bớt app nặng trên Mac (giả lập, trình chạy thử) |
| **Bị chặn** | Đang chờ bạn trả lời, hoặc chờ yêu cầu con khác | Mở yêu cầu hoặc xem tab **Chờ tôi duyệt** trong Hộp thư |
| docs **Lỗi** | Code đổi mà tài liệu chưa sửa theo | Integrator tự sửa. Lặp lại nhiều lần thì nhắn Trợ Lý |
| Project không có trong hộp thoại Yêu cầu mới | Project chưa sẵn sàng | Mở tab **Sẵn sàng** của project, bấm **Làm tiếp** |
| Wizard báo lỗi hoặc đứng ở một bước | Máy chưa làm xong, hoặc lỗi thật ở bước đó | Đọc lỗi, mở app trên Mac nếu có chữ "Chờ app", rồi bấm **Chạy tiếp** |
| "Có người vừa sửa hướng dẫn của agent" | Hai nơi cùng ghi `AGENTS.md` | Bấm **Tải lại** rồi render lại. Hệ thống không bao giờ ghi đè |
| Agent báo hết quota | Gói Claude trên Mac hết hạn mức (dùng chung với Claude Code của bạn) | Chờ hạn mức mở lại |

## 18. Thuật ngữ

| Từ | Nghĩa |
|---|---|
| Yêu cầu (gốc) | Việc bạn tạo và giao cho Trợ Lý |
| Yêu cầu con | Việc Trợ Lý tách ra từ yêu cầu gốc |
| Gói (bundle) | Nhóm yêu cầu con cùng vùng code, do một Executor làm lần lượt |
| Run | Một lần agent chạy |
| Giai đoạn (stage) | Một bước trong luồng duyệt |
| Vòng sửa | Một lần Reviewer hoặc bạn trả việc về sửa (tối đa 5) |
| Vai trò | Trợ Lý, Executor, Reviewer, Integrator |
| Environment | Cấu hình cho agent biết chạy trên máy nào, thư mục nào |
| Checkout | Thư mục repo riêng của một agent trên máy |
| Sẵn sàng | Project hoặc agent đã đủ mọi điều kiện để nhận việc |
| Superpowers | Bộ quy trình làm việc (brainstorm, lập kế hoạch, test trước) mà agent dùng |
