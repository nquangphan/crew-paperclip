# Hướng dẫn sử dụng 2P Crew

{{roles:owner}}
Bạn đang xem bản cho **Owner**: đầy đủ mọi việc, kể cả phần chỉ owner làm (duyệt, Thành viên, Máy, ghép và gỡ máy, thêm project, runtime). Muốn biết người khác thấy gì, chọn vai trò ở ô **Xem hướng dẫn của** góc trên bên phải.
{{/roles}}
{{roles:operator}}
Bạn đang xem bản cho **Admin / Vận hành**: các việc hằng ngày như giao yêu cầu, theo dõi tiến độ, xem project, agent và máy. Phần chỉ owner làm (duyệt cuối, thành viên, ghép máy, thêm project) không nằm ở đây.
{{/roles}}
{{roles:viewer}}
Bạn đang xem bản cho **Chỉ xem**: bạn xem được tổng quan, yêu cầu, project và tài liệu, nhưng không tạo hay sửa được gì.
{{/roles}}
{{roles:contributor}}
Bạn đang xem bản cho **Phòng Marketing / Phòng QC**: cách gửi yêu cầu, viết bình luận và theo dõi trang **Góp ý của tôi**. Mọi thứ bạn gửi đều chờ owner duyệt trước khi đội agent thấy.
{{/roles}}

Mỗi mục trả lời một việc: **là gì**, **làm từng bước thế nào**, rồi **mẹo**. Bấm tên mục ở cột trái để nhảy tới; chép địa chỉ trên thanh trình duyệt để gửi đúng mục đó cho người khác. Số đỏ trên ảnh khớp với số **(1)**, **(2)** trong bài.

## Bắt đầu {#start}

### 2P Crew là gì {#what-is-crew}

2P Crew là một đội agent AI biết lập trình. Bạn viết yêu cầu bằng lời, ví dụ "thêm nút xuất Excel ở trang báo cáo". Đội agent tự chia việc, viết code, tự review, cập nhật tài liệu rồi mở pull request vào nhánh chính. Con người chỉ trả lời khi được hỏi, duyệt ở bước cuối và bấm Merge trên GitHub.

| Thành phần | Là gì |
|---|---|
| **Company** | Không gian làm việc chứa mọi yêu cầu, project và agent. Chọn ở ô trên cùng của thanh bên trái |
| **Project** | Một repo code mà đội agent làm việc trên đó |
| **Agent** | Một "người làm" là AI. Mỗi project có bốn vai trò: Trợ Lý, Executor (viết code), Reviewer (kiểm tra), Integrator (gộp code và mở pull request) |
| **Máy** | Máy Mac chạy agent, có app 2P Crew đang mở |
| **Yêu cầu** | Một việc giao cho đội. Mọi yêu cầu đi qua Trợ Lý và các bước duyệt cố định |

Mỗi người đăng nhập với một **vai trò** trong company; thanh bên trái và các nút bạn thấy tùy theo vai trò đó:

| Vai trò | Làm được |
|---|---|
| **Owner** | Mọi việc: giao yêu cầu, duyệt cuối, mời người, ghép và gỡ máy, thêm project và agent, bật runtime |
| **Admin / Vận hành** | Việc hằng ngày: giao yêu cầu, theo dõi, bình luận, xem project, agent, máy |
| **Chỉ xem** | Xem tổng quan, yêu cầu, project và tài liệu. Không tạo hay sửa gì |
| **Phòng Marketing**, **Phòng QC** | Xem như Chỉ xem, cộng thêm gửi yêu cầu và bình luận để owner duyệt. Hai phòng cùng quyền, chỉ khác tên để owner biết ai gửi |

{{roles:owner}}
Đổi vai trò của một người, và chọn project mỗi người được xem, ở mục [Thành viên](/members).
{{/roles}}
{{roles:operator,viewer,contributor}}
Cần quyền khác thì nhờ owner của company đổi giúp. Bạn chỉ thấy các project owner đã cấp cho bạn và yêu cầu của các project đó; chưa được cấp project nào thì danh sách trống.
{{/roles}}

> **Mẹo:** không cần cài gì trên máy của bạn để dùng web Crew. Chỉ máy chạy agent mới cần app 2P Crew.

### Đăng nhập, ngôn ngữ, đăng xuất {#sign-in}

{{shot:login}}

#### Cách làm

1. Mở địa chỉ Crew mà owner gửi cho bạn.
2. Nhập **Email** (1) và **Mật khẩu** (2), bấm **Đăng nhập** (3). Bạn vào trang **Tổng quan**.
3. Đổi ngôn ngữ: bấm **VI** hoặc **EN** ở góc dưới thanh bên trái, hoặc vào [Cài đặt](/settings), mục **Ngôn ngữ**. Lựa chọn được nhớ trên trình duyệt này.
4. Đăng xuất: bấm tên của bạn ở góc dưới thanh bên trái rồi chọn **Đăng xuất**.

> **Mẹo:** không có nút tạo tài khoản. Tài khoản do owner mời. Sai email hoặc mật khẩu thì trang báo "Sai email hoặc mật khẩu", nhập lại là được.

{{roles:owner,operator}}
> **Lưu ý:** khi app 2P Crew trên Mac xin đăng nhập, trình duyệt mở trang **Cho phép ứng dụng đăng nhập**. Chỉ bấm **Cho phép** nếu chính bạn vừa bật app đó. Không chắc thì bấm **Hủy**.
{{/roles}}

### Màn hình chính và thanh bên {#layout}

{{shot:shell}}

Thanh bên trái chia nhóm giống Paperclip gốc. Trên ảnh:

1. **Company**: đổi company đang xem (nếu bạn ở nhiều company).
2. **Tìm nhanh**: mở ô tìm (mục [Tìm nhanh](#quick-search)).
{{roles:owner,operator,contributor}}
3. **Yêu cầu mới**: mở hộp thoại tạo yêu cầu. Đây là nút dùng nhiều nhất.
{{/roles}}
4. **Hướng dẫn**: trang bạn đang đọc.
5. **VI / EN**: đổi ngôn ngữ.

Các nhóm còn lại:
{{roles:owner}}
- **Công việc**: Yêu cầu, Roadmap, **Chờ duyệt** (góp ý của Phòng Marketing và Phòng QC, con số là số mục đang chờ), Project, Docs.
- **Tổ chức**: Agent, Skills, Máy.
- **Hệ thống**: **Thành viên**, Cài đặt, Hướng dẫn, **Mở giao diện Paperclip gốc**.
{{/roles}}
{{roles:operator}}
- **Công việc**: Yêu cầu, Roadmap, Project, Docs.
- **Tổ chức**: Agent, Skills, Máy.
- **Hệ thống**: Cài đặt, Hướng dẫn.
{{/roles}}
{{roles:viewer}}
- **Công việc**: Yêu cầu, Roadmap, Project, Docs.
- **Hệ thống**: Cài đặt, Hướng dẫn.

Bạn không thấy Hộp thư, Agent, Skills và Máy vì vai trò Chỉ xem không dùng các trang đó.
{{/roles}}
{{roles:contributor}}
- **Công việc**: Yêu cầu, Roadmap, **Góp ý của tôi** (những gì bạn đã gửi), Project, Docs.
- **Hệ thống**: Cài đặt, Hướng dẫn.
{{/roles}}

> **Mẹo:** bấm tiêu đề một nhóm để thu gọn hoặc mở lại. Trang tự cập nhật khi agent làm xong một bước, không cần tải lại.

### Tìm nhanh {#quick-search}

{{shot:palette}}

Ô tìm nhanh mở yêu cầu theo mã hoặc tiêu đề mà không phải rời trang đang xem.

#### Cách làm

1. Bấm **Tìm nhanh** ở thanh bên, hoặc bấm **Ctrl+K** (Windows) hay **Cmd+K** (Mac).
2. Gõ mã yêu cầu như `CRE-12` hoặc vài chữ của tiêu đề (1).
3. Chọn kết quả bằng phím mũi tên rồi **Enter**. Yêu cầu mở trong cửa sổ nổi.

> **Mẹo:** trang **Tìm kiếm** ở thanh bên tìm sâu hơn: cả trong bình luận và tài liệu của yêu cầu.

## Làm việc hằng ngày {#daily}

### Tổng quan {#dashboard}

{{shot:dashboard}}

Trang **Tổng quan** cho bức tranh chung của company ngay khi đăng nhập.

{{roles:owner,operator}}
- Khối **Agent** trên cùng: các run gần đây. Bấm một thẻ để đọc agent đã làm gì; **Xem tất cả run** mở toàn bộ.
- Bốn thẻ số: **Agent đang bật** (1), **Yêu cầu đang làm**, **Yêu cầu bị kẹt**, **Chờ bạn duyệt** (2). Bấm thẻ để mở danh sách tương ứng.
{{/roles}}
{{roles:owner}}
- Thẻ **Góp ý chờ duyệt** (3): số yêu cầu và bình luận của Phòng Marketing và Phòng QC đang chờ bạn.
{{/roles}}
{{roles:viewer,contributor}}
- Các thẻ số (1), (2) cho biết số agent, số yêu cầu đang làm, bị kẹt và đang chờ duyệt. Bạn chỉ xem, không có việc nào ở đây chờ bạn.
{{/roles}}
{{roles:owner}}
- Ba biểu đồ 14 ngày: **Run theo ngày**, **Yêu cầu theo trạng thái**, **Tỉ lệ thành công**.
{{/roles}}
{{roles:operator,viewer,contributor}}
- Biểu đồ 14 ngày **Yêu cầu theo trạng thái**. Số yêu cầu và biểu đồ chỉ tính các project owner đã cấp cho bạn.
{{/roles}}
- Thẻ **Máy**: máy nào đang trực tuyến hay mất liên lạc.
- **Hoạt động gần đây** và **Yêu cầu gần đây**: bấm một yêu cầu để mở cửa sổ chi tiết.

> **Mẹo:** giờ trên mọi trang theo múi giờ Việt Nam.

### Danh sách Yêu cầu {#issue-list}

{{shot:issues-list}}

Trang [Yêu cầu](/issues) giữ giao diện danh sách của Paperclip. Mỗi dòng có biểu tượng trạng thái, tiêu đề, giai đoạn Crew, người làm, nhãn, mã và lúc cập nhật. Yêu cầu con nằm thụt vào dưới yêu cầu gốc; bấm mũi tên để mở hoặc thu. Yêu cầu đang có run hiện nhãn **Đang chạy**.

Thanh công cụ trên ảnh:

{{roles:owner,operator}}
1. **Yêu cầu mới**: tạo yêu cầu (mục [Giao một yêu cầu mới](#new-request)).
{{/roles}}
{{roles:contributor}}
1. **Yêu cầu mới**: gửi yêu cầu để owner duyệt (mục [Gửi yêu cầu để owner duyệt](#send-request)).
{{/roles}}
2. **Tìm yêu cầu**: lọc theo chữ trong tiêu đề hoặc mã.
{{roles:owner,contributor}}
3. **Chờ duyệt (n)**: chỉ hiện nhóm góp ý của Phòng Marketing và Phòng QC đang chờ ở đầu danh sách. Bấm lại để hiện tất cả.
{{/roles}}
4. **Cột**: chọn cột hiện trên mỗi dòng.
5. **Lọc**: lọc theo trạng thái, người làm, project, loại.
6. **Sắp xếp**: mới cập nhật, mới tạo, hay theo tiêu đề. Khi sắp theo ngày, danh sách có vạch **Hôm nay**, **Hôm qua**.
7. **Nhóm**: nhóm theo trạng thái, người làm hoặc project. Bấm tiêu đề nhóm để thu gọn.

{{shot:issues-filter}}

#### Lọc danh sách

1. Bấm **Lọc** (5).
2. Tích một giá trị ở mỗi mục: trạng thái, người làm, project, loại (**Nghiên cứu**, **Viết tài liệu** hoặc **Code / Bug**). Danh sách đổi ngay.
3. Bấm lại mục đang chọn để bỏ, hoặc **Xóa** để bỏ hết. Nút đổi thành **Lọc: n** khi đang có n bộ lọc.

{{shot:issues-columns}}

#### Chọn cột

1. Bấm **Cột** (4).
2. Bật hoặc tắt từng cột. Hai cột riêng của Crew: **Giai đoạn Crew** (yêu cầu đang ở bước nào) và **Yêu cầu con** (dạng "1/3 con xong").
3. **Đặt lại mặc định** đưa về bộ cột ban đầu.

> **Mẹo:** bộ lọc, tìm và cách nhóm nằm trên địa chỉ trang. Chép địa chỉ là gửi được đúng màn hình đang lọc cho người khác.

### Cửa sổ chi tiết yêu cầu {#issue-popup}

{{shot:issue-popup}}

Bấm một yêu cầu ở bất kỳ danh sách nào (Yêu cầu, Hộp thư, Tìm kiếm, Tổng quan, tab Yêu cầu của project) để mở chi tiết trong **cửa sổ nổi** ngay trên trang đang xem. Địa chỉ trang có thêm `?issue=mã`.

Trên ảnh:
1. **Mở toàn trang**: xem trang đầy đủ ở tab mới (hoặc Cmd/Ctrl+click vào yêu cầu trong danh sách).
2. Tiêu đề, mã, và dòng **Tóm tắt Crew**, ví dụ "Crew · 1/3 con xong · Owner duyệt · docs Đạt":
   - **x/y con xong**: số yêu cầu con đã xong trên tổng số;
   - giai đoạn: *Reviewer*, *Integrator · merge + docs*, *Owner duyệt*, *Integrator · push*, *Đã xong*;
   - **docs**: *Đạt* là tài liệu khớp code, *Lỗi* là Integrator sẽ sửa, *Chưa có* là chưa tới bước kiểm.
3. **Thuộc tính**: trạng thái, người làm, project, loại, model, giai đoạn và người duyệt, vòng sửa (tối đa 5), giờ tạo và cập nhật. Nhóm **Runtime** cho biết runtime đã chọn và các lần tự chuyển.

Bên dưới là mô tả, tài liệu, đính kèm, run của yêu cầu và **Bình luận**: agent ghi lại từng bước ở đây và run đang chạy hiện trực tiếp. Nút **Mở map** vẽ yêu cầu gốc ở giữa và các yêu cầu con tỏa quanh, cùng kiểu với bản đồ [Roadmap](/roadmap): việc bạn đang xem có viền đậm, nét đứt là chặn (phải xong trước), nét chấm là vòng sửa; bấm một thẻ để mở việc đó, rê chuột lên thẻ để xem đủ loại việc, giai đoạn và số vòng sửa. Bên dưới bản đồ là kết quả **Kiểm docs**.

Đóng cửa sổ bằng **Esc**, nút **×**, bấm ra vùng nền, hoặc nút Back của trình duyệt: bạn về đúng chỗ cũ trong danh sách.

{{roles:owner,operator}}
#### Luồng một yêu cầu đi qua

```
Bạn giao cho Trợ Lý
  → Trợ Lý đọc tài liệu project, hỏi lại nếu thiếu thông tin
  → Trợ Lý chia thành yêu cầu con, chọn model, giao cho Executor
  → Executor viết code (test trước)  →  Reviewer duyệt từng yêu cầu con
  → yêu cầu gốc qua: (1) Reviewer → (2) Integrator gộp code, kiểm tài liệu
     → (3) OWNER DUYỆT → (4) Integrator mở pull request vào nhánh chính
  → owner bấm Merge trên GitHub
```

#### Pull request sau khi duyệt

Duyệt xong, Integrator không tự gộp vào nhánh chính. Nó đẩy nhánh `crew/req/<mã yêu cầu>` đúng bản code bạn đã duyệt, mở một pull request vào nhánh chính rồi thêm mục **Merge request** vào cuối phần **Tổng kết của Trợ Lý** trong mô tả yêu cầu: link PR, trạng thái và conflict nếu có. Nội dung PR lấy từ chính phần tổng kết đó.

- Mở link, xem thay đổi trên GitHub rồi bấm **Merge**. Code chỉ vào nhánh chính lúc bạn bấm.
- PR báo conflict thì Integrator không tự sửa: bạn xử lý trên GitHub, hoặc mở lại yêu cầu và ghi rõ cần sửa gì.
- Repo không ở GitHub thì Integrator đẩy thẳng vào nhánh chính như trước và ghi rõ điều đó trong bình luận.
- Project bật deploy tự động chỉ deploy sau khi PR được merge, đúng commit merge trên nhánh deploy. PR đóng mà không merge thì không deploy (bình luận `crew-deploy … status=cancelled`); quá 3 ngày chưa merge thì job thôi chờ.

Một yêu cầu nhỏ thường xong trong 15 đến 30 phút.

#### Khi Trợ Lý hỏi lại

Yêu cầu chưa rõ thì Trợ Lý đặt một **thẻ câu hỏi** ngay trong yêu cầu ("Trợ Lý cần hỏi"), có sẵn lựa chọn và ô **Khác**. Yêu cầu chuyển **Bị chặn** trong lúc chờ. Chọn đáp án rồi bấm **Gửi trả lời**, Trợ Lý chạy tiếp. Thẻ "Trợ Lý cần xác nhận" có hai nút **Đồng ý** và **Từ chối** (nên ghi lý do khi từ chối).

Bạn sửa được tiêu đề, mô tả, viết bình luận và đính kèm file. Bấm file đính kèm (cả link file trong mô tả, bình luận) để xem ngay trong trang, không mở tab mới: ảnh xem lớn và chuyển ảnh bằng nút hoặc phím mũi tên, PDF, markdown, code và mockup HTML hiện sẵn; file khác có nút **Tải về**. Ô viết bình luận nằm ngay trên luồng trao đổi, bình luận mới nhất ở trên cùng. Ảnh trong mô tả và bình luận (file đính kèm, ảnh PNG/JPEG/GIF/WebP nhúng base64) hiện vừa khung, bấm để xem lớn; ảnh SVG hay loại nhúng khác bị chặn và chỉ hiện tên kèm ghi chú "ảnh bị chặn", ảnh ở trang web khác hiện thành link. Run đang chạy có nút **Dừng run** (có hộp xác nhận).
{{/roles}}
{{roles:owner}}
Yêu cầu đang chờ bạn duyệt có nút **Duyệt**, **Yêu cầu sửa**, **Hủy yêu cầu**, **Ép Done** ngay dưới tiêu đề (mục [Duyệt, yêu cầu sửa, hủy, mở lại](#approve)).
{{/roles}}
{{roles:operator}}
Nút **Duyệt** và **Yêu cầu sửa** chỉ hiện với người được giao duyệt, thường là owner. Bạn vẫn có **Hủy yêu cầu** và **Mở lại** khi cần.
{{/roles}}
{{roles:viewer}}
Bạn đọc được mọi thứ trong cửa sổ, nhưng không có ô bình luận hay nút thao tác.
{{/roles}}
{{roles:contributor}}
Ô bình luận của bạn gửi bình luận để owner duyệt (mục [Bình luận góp ý](#send-comment)). Bạn không sửa hay đổi trạng thái được.
{{/roles}}

### Roadmap {#roadmap}

{{shot:roadmap}}

Trang [Roadmap](/roadmap) vẽ cả company thành một bản đồ: company ở giữa, các project tỏa quanh. Mỗi project ghi số yêu cầu do người tạo và số đang mở. Bạn chỉ thấy các project được cấp; yêu cầu do agent tự tạo (routine) không hiện.

Trên ảnh:
1. **Đường dẫn** company › project › yêu cầu: bấm một chặng để về tầng đó.
2. Nút **Docs** của project: số trang tài liệu, hoặc **Chưa có docs** khi máy chưa gửi bản docs nào.
3. Một **yêu cầu**: viền trái theo màu trạng thái, thanh tiến độ "x/y việc con xong".
4. **Bản đồ / Danh sách**: xem cùng nội dung dạng danh sách lồng nhau (gọn hơn trên điện thoại, đọc được bằng trình đọc màn hình).

#### Đi vào và lùi ra

1. Bấm một project: bản đồ phóng vào project đó rồi thu ra để lộ các yêu cầu của nó.
2. Bấm một yêu cầu: lộ cây việc con (cả cháu chắt). Đường liền nối cha với con; đường đứt có mũi tên là **chặn**: việc ở đầu mũi tên phải chờ việc kia xong.
3. Bấm một việc con, hoặc yêu cầu ở giữa: mở [cửa sổ chi tiết yêu cầu](#issue-popup).
4. Bấm **Docs**: lộ thư mục và trang tài liệu của project (bộ docs chỉ có một thư mục thì vào thẳng thư mục đó). Bấm thư mục để đi vào, bấm trang để đọc trong cửa sổ nổi; link trong bài mở trang khác ngay trong cửa sổ, nút **Mở trong trang Docs** mở đúng trang đó ở trang [Docs](/docs).
5. Lùi một tầng bằng nút **Lùi**, phím **Esc**, đường dẫn ở trên, hoặc nút Back của trình duyệt.

Bản đồ luôn giữ cỡ chữ đọc được: tầng rộng hơn màn hình thì kéo để xem phần còn lại, cuộn hoặc chụm hai ngón để phóng to thu nhỏ, nút **+ / − / ⤢** ở góc dưới phải (⤢ thu nhỏ cho thấy cả tầng). **Chú thích** màu và nét nằm dưới bản đồ, bấm để thu gọn hoặc mở. Một tầng quá nhiều mục thì hiện nút **+N khác**: bấm để xem đủ ở dạng danh sách.

> **Mẹo:** tầng đang xem nằm trên địa chỉ trang, nên chép địa chỉ là gửi được đúng chỗ đang xem cho người khác.

### Giao một yêu cầu mới {#new-request roles=owner,operator}

{{shot:new-request}}

Yêu cầu là cách duy nhất để giao việc cho đội agent. Mọi yêu cầu đi qua Trợ Lý của project.

#### Cách làm

1. Bấm **Yêu cầu mới** ở thanh bên trái hoặc ở trang Yêu cầu.
2. Chọn **Project** (1). Danh sách chỉ có project đã **sẵn sàng**. Không có project nào sẵn sàng thì hộp thoại báo "Chưa có project nào sẵn sàng" (xem mục [Project](#projects)).
3. Chọn **Loại** (2): **Code**, **Bug**, **Nghiên cứu** hoặc **Viết tài liệu** (bảng dưới).
4. Viết **Tiêu đề** (3) một câu, và **Mô tả** (4): muốn gì, vì sao, ở chỗ nào, cái gì không được đụng.
5. **Đính kèm** ảnh hoặc file nếu cần. File có đuôi lạ hiện cảnh báo, bạn vẫn gửi được.
6. **Người nhận** luôn là Trợ Lý của project, không đổi được.
7. Bấm **Tạo** (6). Chưa muốn đội bắt đầu thì bấm **Lưu nháp (chưa chạy)** (5).
8. Yêu cầu nháp có trạng thái **Nháp** và chưa giao cho agent. Khi muốn đội làm, mở yêu cầu (hoặc dùng nút trên dòng của nó ở trang Yêu cầu) rồi bấm **Bắt đầu làm**: yêu cầu chuyển sang **Cần làm** và Trợ Lý được gọi ngay, như khi tạo không lưu nháp.

| Loại | Khi nào | Ghi chú |
|---|---|---|
| **Code** | Thêm hoặc sửa tính năng | Đi đủ các bước duyệt |
| **Bug** | Có lỗi | Tả **triệu chứng**: "bấm X thì ra Y, đúng ra phải Z". Agent viết test bắt lỗi rồi mới sửa |
| **Nghiên cứu** | Cần so sánh, đề xuất, không sửa code | Chỉ hai bước duyệt: Reviewer rồi owner, không đẩy code. Company phải có nhãn "research" |
| **Viết tài liệu** | Cần file tài liệu trong repo: spec, mockup, markdown, ảnh | Đi đủ các bước duyệt như Code (gộp, kiểm docs, owner duyệt rồi mở pull request). Agent không viết test code, không sửa code trừ khi yêu cầu ghi rõ; vẫn đính kèm ảnh chụp tài liệu hoặc mockup. Company phải có nhãn "docs" |

> **Ví dụ tốt:** *Tiêu đề:* Thêm nút xuất Excel ở trang báo cáo. *Mô tả:* Trang Báo cáo doanh thu cần nút Xuất Excel, file có cột Ngày, Đơn hàng, Tổng tiền. Không đổi cách tính tổng.

> **Mẹo:** một yêu cầu, một mục tiêu. Hai việc không liên quan thì tạo hai yêu cầu. Thiếu thông tin cũng không sao, Trợ Lý sẽ hỏi lại.

#### Thêm việc con vào một yêu cầu

Muốn bổ sung một việc cho yêu cầu đang chạy, mở yêu cầu gốc (trang đầy đủ hoặc cửa sổ nổi) rồi bấm **Thêm việc con** ở đầu trang. Nút chỉ có trên yêu cầu gốc chưa xong và chưa hủy.

1. Viết **Tiêu đề**, **Mô tả** (markdown) và **Đính kèm** nếu cần, như khi tạo yêu cầu mới. Loại việc theo yêu cầu gốc; bạn không chọn người làm hay model.
2. Bấm **Thêm việc con**. Việc con hiện ở **Yêu cầu con** của yêu cầu gốc, và trong luồng bình luận có dòng "Đã thêm việc con …" để báo Trợ Lý.
3. Trợ Lý ghi việc đó vào kế hoạch, chọn executor và model rồi giao. Việc con đi đúng luồng như các việc con Trợ Lý tự tách: executor làm, Reviewer duyệt, Integrator gộp vào nhánh của yêu cầu trước khi bạn duyệt yêu cầu gốc.

Chỉ thêm được khi yêu cầu đang ở bước Trợ Lý (**Cần làm**, **Đang làm**, **Bị chặn**). Yêu cầu còn **Nháp** thì ghi thêm việc vào mô tả, hoặc bấm **Bắt đầu làm** trước. Yêu cầu đã sang Reviewer, Integrator hay chờ duyệt thì hộp thoại giải thích lý do: code đã gộp và kết quả kiểm tài liệu sẽ không còn đúng nếu chèn việc giữa chừng. Lúc đó đợi tới bước **Owner duyệt**, bấm **Yêu cầu sửa** và ghi rõ việc cần thêm; yêu cầu quay về Trợ Lý, việc mới được làm, review và gộp trước khi bạn duyệt lại.

### Duyệt, yêu cầu sửa, hủy, mở lại {#approve roles=owner}

{{shot:issue-gate}}

Khi giai đoạn là **Owner duyệt**, đến lượt bạn. Yêu cầu hiện ở thẻ **Chờ bạn duyệt** của Tổng quan và tab **Chờ tôi duyệt** của Hộp thư.

#### Cách làm

1. Mở yêu cầu. Xem bình luận của Reviewer, kết quả **Kiểm docs** là Đạt và mọi yêu cầu con đã xong.
2. Chọn một nút ở đầu trang:

| Nút | Dùng khi | Chuyện xảy ra |
|---|---|---|
| **Duyệt** (1) | Đồng ý | Hộp thoại có ô **Lời nhắn khi duyệt** điền sẵn "Đã xem, duyệt.", không được để trống. Xác nhận thì Integrator mở pull request (link ở mục **Merge request** của tổng kết) và yêu cầu thành **Hoàn thành**; code vào nhánh chính khi bạn bấm Merge trên GitHub |
| **Yêu cầu sửa** (2) | Chưa đồng ý | Viết **Lý do cần sửa** (ít nhất 5 ký tự), **Gửi yêu cầu sửa**. Việc quay về người làm, tính thêm một vòng sửa. Với yêu cầu code hay viết tài liệu, lần nộp lại chạy lại từ đầu: Reviewer xem lại, Integrator gộp lại cả việc sửa mới và kiểm docs, rồi mới về bạn duyệt lại; **Lịch sử** ghi dòng *Owner yêu cầu sửa: lần nộp lại chạy lại từ Reviewer* |
| **Hủy yêu cầu** (3) | Không cần nữa | Có hộp xác nhận. Yêu cầu thành **Đã hủy**, run đang chạy bị dừng |
| **Ép Done** (4) | Bất khả kháng | Mục [Ép Done](#force-done) |
| **Mở lại** | Yêu cầu đã xong hoặc đã hủy mà cần làm lại | Yêu cầu về **Cần làm**, chạy lại từ đầu ở vòng mới |

> **Mẹo:** hết 5 vòng sửa mà chưa đạt thì yêu cầu được chuyển cho bạn quyết. Lúc đó trả lời bằng **bình luận** nói rõ hướng xử lý, không có nút Duyệt. Không có ô chọn trạng thái tự do (lý do ở mục [Vì sao không có nút X](#missing-buttons)).

### Ép Done {#force-done roles=owner}

{{shot:force-done}}

**Ép Done** đóng một yêu cầu ngay dù chưa qua hết các cổng. Đây là lối thoát khi bất khả kháng (việc đã làm tay ngoài Crew, luồng bị kẹt mà bạn đã tự kiểm), không phải cách duyệt thường.

#### Cách làm

1. Bấm **Ép Done** ở đầu trang yêu cầu. Hộp thoại liệt kê **các cổng sẽ bị bỏ qua** và run sẽ bị dừng.
2. Ô **hủy luôn các việc con chưa xong** bật sẵn: chỉ hủy đúng các việc con liệt kê, sau khi yêu cầu đã đóng. Việc cháu không bị hủy.
3. Điền **Lý do** (1), bắt buộc, 10 đến 1000 ký tự, rồi bấm **Ép Done**.

Kết quả: yêu cầu thành **Hoàn thành**, mang nhãn **Đã ép Done**; lý do thành bình luận của owner; **Lịch sử** ghi người ép, giờ và các cổng bỏ qua. Code chưa đẩy thì không tự được đẩy.

> **Mẹo:** ép nhầm thì bấm **Mở lại** để chạy lại từ đầu. Việc con nào hủy lỗi thì trang hiện nút **Hủy các con còn lại**.

### Hộp thư {#inbox roles=owner,operator}

{{shot:inbox}}

**Hộp thư** gom những thứ đang cần bạn. Con số bên cạnh mục Hộp thư ở thanh bên là số mục chưa đọc.

#### Cách làm

1. Mở **Hộp thư** ở thanh bên.
2. Tab **Chờ tôi duyệt** (1): yêu cầu ở bước Owner duyệt và câu hỏi Trợ Lý chờ bạn trả lời. Duyệt xong thì mục tự biến mất.
3. Các tab **Của tôi**, **Chưa đọc**, **Đang kẹt**, **Tất cả** lọc theo nhu cầu; có ô tìm theo mã hoặc tiêu đề và lọc trạng thái.
4. Chấm bên trái là chưa đọc. **Đánh dấu đã đọc**, **Đánh dấu chưa đọc**, **Đánh dấu tất cả đã đọc**, hoặc **Lưu trữ** một mục (mục chỉ rời Hộp thư, yêu cầu vẫn còn).

> **Mẹo:** mở Hộp thư mỗi sáng là đủ biết hôm nay cần làm gì.

### Runtime: Claude, Codex, OpenCode {#runtimes roles=owner,operator}

{{shot:machines}}

Mặc định mọi agent chạy bằng **Claude**. Hai runtime phụ, **Codex** và **OpenCode**, bật theo từng máy ở khối **Runtime** (3) trên trang [Máy](/machines). Dòng `crew-model` trong mô tả yêu cầu con có `runtime=` cho biết Executor của việc đó chạy bằng runtime nào (không có `runtime=` là Claude).

{{roles:owner}}
#### Bật hoặc tắt một runtime

1. Mở trang [Máy](/machines), tìm thẻ máy, khối **Runtime**.
2. Gạt công tắc **Codex** hoặc **OpenCode**. **Claude bật sẵn; Codex và OpenCode tắt sẵn.** Bật phải qua hộp xác nhận vì run mới sẽ dùng quota gói của bạn.
3. Máy chưa có runtime thì bấm **Cài runtime trên máy** (xếp việc cho app trên Mac).

**Chỉ board** (owner) nên gạt công tắc; người khác thấy để biết. Tắt một runtime thì việc đang chờ được giữ lại hoặc chuyển sang agent khác, không mất. OpenCode bị khóa khi server chưa bật vá chạy đúng thư mục làm việc; thẻ ghi rõ lý do.
{{/roles}}
{{roles:operator}}
Công tắc runtime do owner quyết. Bạn xem được trạng thái từng runtime trên thẻ máy.
{{/roles}}

#### Khối Runtime trong yêu cầu

Thuộc tính của yêu cầu có nhóm **Runtime** liệt kê quyết định, mới nhất ở trên (tối đa 50 dòng): **Chọn** (runtime, agent, model và lý do), **Chuyển** (Crew tự chuyển runtime, ghi nguyên nhân: hết quota, lỗi đăng nhập hoặc key, runtime không dùng được, công tắc tắt) và **Từ chối chuyển** (muốn chuyển nhưng không an toàn).

**Tự chuyển runtime** cho Executor:
- Chỉ chuyển khi run lỗi vì hết quota, lỗi đăng nhập hoặc key, runtime không dùng được, hoặc công tắc đang tắt mà việc đang chờ.
- Chuyển sang agent khác **cùng máy**, còn rảnh, công tắc bật. Mỗi yêu cầu chuyển tối đa **2 lần**.
- Việc **large** không bị chặn khi hết chỗ chuyển: nó chờ Claude có lại quota rồi chạy tiếp.
- Thư mục làm việc cũ còn thay đổi chưa commit thì không chuyển: Crew bình luận và đặt yêu cầu **Bị chặn**.

**Reviewer Codex** chỉ duyệt **yêu cầu con loại code**. Reviewer Codex lỗi (kể cả hết quota) hoặc công tắc Codex tắt giữa chừng thì Crew **tự chuyển về Reviewer Claude** của project, số vòng sửa giữ nguyên.

> **Mẹo:** model **kimi-k3** (OpenCode) hiện **chưa nhận ảnh**. Việc có ảnh đính kèm nên để Claude hoặc Codex làm.

## Phòng Marketing và Phòng QC {#marketing}

### Phòng Marketing và Phòng QC là gì {#marketing-overview roles=owner,contributor}

{{roles:contributor}}
{{shot:contributions-mine}}
{{/roles}}
{{roles:owner}}
{{shot:contributions-owner}}
{{/roles}}

**Phòng Marketing** và **Phòng QC** là thành viên chỉ xem mọi project, yêu cầu và bình luận, cộng thêm quyền gửi **yêu cầu** và **bình luận** để owner duyệt. Trong lúc chờ, **agent không thấy gì**: nội dung chờ không nằm trong danh sách, bình luận hay ngữ cảnh của agent, nên không agent nào bị đánh thức. Chỉ owner duyệt hay từ chối được. Hai phòng gửi góp ý như nhau; owner thấy tên phòng cạnh người gửi (ví dụ **Lan · Phòng QC**) để biết góp ý đến từ đâu.

**Phòng QC duyệt lại yêu cầu của mình.** Yêu cầu do Phòng QC gửi (tính theo phòng lúc gửi), khi xong, mang trạng thái **Chờ QC duyệt** thay cho Hoàn thành và được giao lại cho người QC đã gửi. Agent vẫn coi yêu cầu là xong, không ai bị đánh thức. Người QC kiểm tra rồi:

- **Xác nhận đạt**: yêu cầu thành **QC verified**. Chỉ đổi trạng thái QC, không có bình luận hay việc gì thêm.
- **Chưa đạt**: viết lý do (bắt buộc). Lý do chờ owner duyệt như mọi góp ý, yêu cầu hiện **Chờ owner duyệt mở lại**. Owner duyệt thì yêu cầu mở lại cho người làm và lý do thành bình luận; owner từ chối thì yêu cầu quay về **Chờ QC duyệt**.

Owner cũng bấm **Xác nhận đạt** được. Yêu cầu mở lại rồi xong lần nữa thì lại **Chờ QC duyệt** từ đầu. Yêu cầu của owner và của Phòng Marketing không có bước này.

| Trạng thái | Nghĩa |
|---|---|
| **Chờ duyệt** | Đã gửi, owner chưa xem |
| **Đã duyệt** | Owner đã đăng nội dung; agent bắt đầu làm như owner tự đăng |
| **Bị từ chối** | Owner không đăng. Mục vẫn còn, chỉ người gửi và owner thấy; agent không bao giờ thấy |

{{roles:contributor}}
Phòng Marketing và Phòng QC không sửa, không đổi trạng thái, không giao việc và không xóa được gì.
{{/roles}}

### Gửi yêu cầu để owner duyệt {#send-request roles=contributor}

{{shot:contribution-new}}

#### Cách làm

1. Bấm **Yêu cầu mới** ở thanh bên trái. Hộp thoại **Gửi yêu cầu (chờ duyệt)** mở ra.
2. Chọn **Project** (1).
3. Viết **Tiêu đề** (2) một câu và **Mô tả**: muốn gì, ở trang nào, vì sao.
4. Bấm **Gửi để owner duyệt** (3). Hộp thoại báo "Đã gửi, chờ owner duyệt".

Bạn không chọn loại, người nhận hay đính kèm: owner chọn lúc duyệt.

> **Mẹo:** viết như đang nhắn cho người làm: "Đổi ảnh banner trang chủ cho chiến dịch tháng 11, giữ nguyên chữ". Một yêu cầu, một việc.

### Bình luận góp ý {#send-comment roles=contributor}

{{shot:contribution-comment}}

#### Cách làm

1. Mở một yêu cầu (bấm vào nó ở trang Yêu cầu).
2. Kéo xuống ô bình luận, viết góp ý.
3. Bấm **Gửi để owner duyệt** (2). Bình luận hiện ngay trong luồng với nhãn **Chờ duyệt** (1); chỉ bạn và owner thấy.

Owner duyệt thì bình luận được đăng dưới tên owner, có dòng **Góp ý của <tên bạn>**, và agent được báo như khi owner bình luận.

### Theo dõi Góp ý của tôi {#my-contributions roles=contributor}

{{shot:contributions-mine}}

Trang [Góp ý của tôi](/contributions) liệt kê mọi thứ bạn đã gửi.

#### Cách làm

1. Bấm **Góp ý của tôi** ở thanh bên trái.
2. Chọn tab (1): **Chờ duyệt**, **Bị từ chối** hoặc **Đã duyệt**.
3. Mục **Đã duyệt** có link **Mở yêu cầu đã tạo** hoặc **Xem bình luận đã đăng** tới nội dung thật.

> **Mẹo:** mục **Bị từ chối** vẫn được giữ để bạn xem lại. Muốn gửi lại thì sửa nội dung và gửi một yêu cầu mới.

#### Cần tôi duyệt (Phòng QC)

Thành viên Phòng QC thấy mục **Cần tôi duyệt** ở đầu trang [Góp ý của tôi](/contributions) và thẻ cùng tên ở Tổng quan: các yêu cầu bạn đã gửi, nay đã xong và chờ bạn kiểm tra.

1. Bấm vào một yêu cầu trong **Cần tôi duyệt**. Khối **Phòng QC duyệt lại** nằm dưới tiêu đề.
2. Kiểm tra kết quả. Đạt thì bấm **Xác nhận đạt**: yêu cầu thành **QC verified**.
3. Chưa đạt thì bấm **Chưa đạt**, viết chỗ nào chưa đạt và cách tái hiện, bấm **Gửi để owner duyệt**. Yêu cầu hiện **Chờ owner duyệt mở lại** cho tới khi owner quyết định; agent chưa thấy lý do của bạn.

### Duyệt hoặc từ chối góp ý {#review-contributions roles=owner}

{{shot:contributions-owner}}

Mục **Chờ duyệt** ở thanh bên trái có số mục đang chờ; Tổng quan có thẻ **Góp ý chờ duyệt**. Bạn duyệt ở trang [Chờ duyệt](/contributions) (tab (1)), ở nhóm **Chờ duyệt** đầu trang [Yêu cầu](/issues), hoặc ngay trong luồng bình luận. Cạnh tên người gửi có tên phòng (**Phòng Marketing** hoặc **Phòng QC**).

{{shot:contribution-approve}}

#### Duyệt một yêu cầu

1. Bấm **Duyệt** (2) trên dòng yêu cầu.
2. Hộp thoại **Duyệt yêu cầu** cho chọn **Project**, **Loại** (Code, Bug, Nghiên cứu, Viết tài liệu), **Agent nhận việc** (mặc định Trợ Lý của project) và ô **Lưu nháp**.
3. Bấm **Duyệt**. Yêu cầu được đăng nguyên văn như bạn tự đăng, agent bắt đầu làm (trừ khi lưu nháp).

#### Duyệt một bình luận

Bấm **Duyệt** một lần: bình luận được đăng dưới tên bạn, kèm dòng **Góp ý của <tên>**, agent được báo như khi bạn bình luận.

#### Từ chối

Bấm **Từ chối** (3), xác nhận. Mục mang nhãn **Bị từ chối**, chỉ người gửi và bạn thấy.

#### Duyệt yêu cầu mở lại của Phòng QC

Khi người QC báo **Chưa đạt** một yêu cầu đã xong, trang Chờ duyệt có mục **QC yêu cầu mở lại** kèm lý do; khối **Phòng QC duyệt lại** trong yêu cầu cũng hiện lý do và hai nút.

- **Duyệt**: lý do được đăng thành bình luận dưới tên bạn, yêu cầu mở lại (về Cần làm) cho người làm trước đó và agent được đánh thức, như khi bạn tự bình luận mở lại. Lần xong sau lại chờ QC duyệt.
- **Từ chối**: yêu cầu giữ nguyên Hoàn thành và quay về **Chờ QC duyệt**; agent không bao giờ thấy lý do.

> **Mẹo:** lần duyệt bị đứt giữa chừng (mất mạng, đóng tab) thì mục mang nhãn **Đang duyệt dở** kèm nút **Duyệt lại**; bấm lại không tạo bản trùng. Hai owner cùng duyệt một mục thì người đến sau được báo đang có người duyệt.

## Project và agent {#projects-agents}

### Project {#projects roles=owner,operator,viewer}

{{shot:projects}}

Trang [Project](/projects) liệt kê các project kèm số yêu cầu và cột **Sẵn sàng** (2). Project **chưa sẵn sàng** không có trong hộp thoại Yêu cầu mới.

{{roles:owner,operator}}
- **Thêm project** (1): dựng project mới bằng wizard (việc của owner).
- **Đang dùng / Đã gỡ** (3): project đã gỡ chỉ hiện ở **Đã gỡ**.
- Bấm ngôi sao để ghim project lên thanh bên, ngay dưới mục Project.
- Project chưa sẵn sàng có nút **Làm tiếp** dẫn vào wizard để hoàn tất.
{{/roles}}
{{roles:viewer}}
Bạn chỉ xem, không có nút thêm hay sửa.
{{/roles}}

{{shot:project-roles}}

#### Các tab của một project

Bấm tên project. Các tab ở trên (1):
- **Yêu cầu**: yêu cầu của project.
- **Vai trò**: ai giữ Trợ Lý, Executor, Reviewer, Integrator.
- **Docs**: tài liệu project.
- **Sẵn sàng**: danh sách kiểm; mục chưa đạt có nút **Làm tiếp**.

{{roles:owner,operator}}
- **Đổi tên**: tên, mô tả, màu, biểu tượng.

#### Đổi người giữ vai trò

1. Mở tab **Vai trò**, bấm **Sửa vai trò** (2).
2. Chọn agent cho từng ô, bấm **Lưu vai trò**. `AGENTS.md` của Trợ Lý được cập nhật theo.
{{/roles}}

**Sẵn sàng** gồm: cấu hình agent đúng, ghim đúng Superpowers, `AGENTS.md` khớp vai trò, environment SSH đúng, thư mục làm việc có trên máy, agent đang giữ vai trò.

### Thêm project {#add-project roles=owner}

{{shot:add-project}}

Bấm [Thêm project](/projects/new) ở trang Project. Wizard dựng mọi thứ; **repo git phải có sẵn trên máy Mac** (Crew không tải repo về).

#### Cách làm

1. **Máy**: chọn máy Mac. "App chưa chạy" nghĩa là app 2P Crew chưa mở, các bước trên máy sẽ chờ.
2. **Folder repo trên máy**: đường dẫn đầy đủ, ví dụ `/Users/ten/code/my-repo`. Folder đã kiểm trước đây được gợi ý sẵn.
3. **Khóa project**: chữ thường, số, gạch ngang, bắt đầu bằng chữ, 2 đến 31 ký tự. Không trùng project đã có.
4. **Tên project** và **Số executor** (1 hoặc 2), rồi **Bắt đầu**.
5. Wizard chạy 7 bước và hiện từng bước: kiểm folder repo, tạo project, tạo checkout cho từng vai trò, tạo environment SSH, tạo agent và AGENTS.md, ghi vai trò, kiểm trên máy.
6. Xong thì bấm **Mở project**.

> **Mẹo:** một bước lỗi thì wizard tạm dừng các agent đã tạo, hiện lỗi và nút **Chạy tiếp**: bấm là chạy tiếp từ bước dở, không tạo trùng. Đóng trang giữa chừng cũng không sao, project dở có nút **Làm tiếp** ở danh sách.

### Agent {#agents roles=owner,operator}

{{shot:agents}}

Trang [Agent](/agents) liệt kê agent kèm vai trò, trạng thái và **Sẵn sàng**. Bấm **Tạo agent** (1) để thêm agent (việc của owner); lọc (2) **Đang chạy**, **Tạm dừng**, **Lỗi**, **Đã gỡ**.

{{shot:agent-detail}}

#### Xem và điều khiển một agent

1. Bấm tên agent. Các tab (1):
   - **Tổng quan**: run gần nhất, yêu cầu đang làm, máy, vai trò, mục còn thiếu.
   - **Hướng dẫn**: xem `AGENTS.md` (chỉ đọc). **Render lại theo vai trò** ghi lại bản đúng; có người vừa sửa thì báo xung đột và không ghi đè.
   - **Skills**: bật hoặc tắt skill cho agent này, hiệu lực từ run kế tiếp.
   - **Cấu hình chạy**: adapter, lệnh, environment, máy. Chỉ đổi được **Model mặc định**.
   - **Run**: các lần chạy.
2. **Tạm dừng** dừng agent và hủy run đang chạy; **Tiếp tục** cho chạy lại.

> **Mẹo:** agent chưa xong các bước dựng ở trạng thái **Chưa sẵn sàng** và không có trong ô chọn nào. Bấm **Làm tiếp** để hoàn tất.

### Tạo agent {#add-agent roles=owner}

{{shot:add-agent}}

Dùng khi cần thêm Executor hoặc thay người giữ vai trò. Mở bằng [Tạo agent](/agents/new) ở trang Agent, hoặc **Thêm executor** ở tab Vai trò của project.

#### Cách làm

1. Chọn **Project** và **Ô vai trò**, đặt **Tên agent**, chọn **Model**.
2. **Máy**, **Khóa project** và **Folder repo trên máy** tự điền theo các agent đang chạy của project, kể cả project thêm từ app Mac: máy là máy đang chạy agent, folder là repo gốc của checkout `~/crew-agents/<khóa>/<ô>` (form hỏi app 2P Crew trên máy vài giây). Chỉ khi không suy được (project chưa có agent, hay app trên máy chưa mở) thì mới phải chọn máy và nhập folder.
3. Bấm **Bắt đầu**. Wizard chạy 6 bước: tạo agent, ghim Superpowers và AGENTS.md, environment SSH (chép host SSH của đúng máy đã chọn; máy chưa có environment mẫu thì dừng, không mượn máy khác), dựng checkout trên máy, ghi vai trò, cập nhật AGENTS.md của Trợ Lý.
4. Xong có **Mở agent** và **Mở project**. Bước nào dừng thì bấm **Chạy tiếp**. **Sửa tiếp** từ bước environment sửa luôn environment trỏ nhầm máy.

> **Mẹo:** chỉ người dùng trên web tạo được agent. Agent không tạo được agent khác.

### Gỡ project và gỡ agent {#remove roles=owner}

{{shot:project-roles}}

Gỡ nghĩa là **ngừng dùng mà giữ dữ liệu**, không xóa gì.

#### Gỡ project

1. Mở project, bấm **Gỡ project** (3) ở đầu trang.
2. Gõ đúng tên project để xác nhận. Hộp thoại liệt kê điều sẽ xảy ra.
3. Crew tạm dừng agent trong vai trò, xóa vai trò, lưu trữ environment riêng, gỡ checkout **sạch** trên máy rồi lưu trữ project. Nhánh git, thư mục gốc và yêu cầu chưa xong giữ nguyên.

#### Gỡ agent

{{shot:agent-detail}}

1. Mở agent, bấm **Gỡ agent** (2).
2. Agent rời vai trò (`AGENTS.md` của Trợ Lý cập nhật), bị tạm dừng, environment riêng được lưu trữ, checkout sạch được gỡ. Agent không bị xóa.
3. Agent đang là Trợ Lý, reviewer, integrator hay executor duy nhất thì nút tắt kèm lý do và link **Đổi vai trò** hoặc **Gỡ cả project**.

> **Mẹo:** checkout có thay đổi chưa commit được giữ lại; trang tiến độ đưa lệnh `git worktree remove` để bạn tự làm sau khi xem. Lỗi giữa chừng thì nút đổi thành **Chạy tiếp gỡ project** hoặc **Chạy tiếp gỡ agent**. Muốn dùng lại: project dùng wizard Thêm project; agent bấm **Tiếp tục** rồi gán lại vai trò.

### Skills {#skills roles=owner,operator}

{{shot:skills}}

Trang [Skills](/skills) liệt kê skill (khả năng bổ sung cho agent) của company, nguồn, số agent đang dùng và đã đồng bộ lên mấy máy.

#### Thêm skill

1. Bấm **Thêm skill** (1), dán địa chỉ repo GitHub (có thể thêm nhánh hoặc tag), bấm **Quét repo**.
2. Chọn skill, **Xem trước** nếu cần, rồi **Thêm skill**.
3. Mở skill, **Bật cho agent** cần dùng. Mục **Đồng bộ lên máy** cho biết từng máy đã đồng bộ, đang chờ hay lỗi.

#### Sửa, cập nhật, xóa

- **Sửa thông tin** đổi tên hiển thị và mô tả; sửa file thì chọn file, sửa, **Lưu file**. Chỉ skill do Crew quản lý mới sửa được; hai người lưu cùng lúc thì người lưu sau thắng.
- **Kiểm cập nhật** và **Cập nhật từ nguồn** cho skill từ GitHub. Skill không sửa được thì **Tạo bản sửa được**.
- **Đổi nguồn**: **Thêm từ nguồn mới**, bật cho các agent, rồi **Xóa skill** bản cũ.
- **Xóa skill**: gõ lại tên để xác nhận. Crew gỡ skill khỏi các agent trước rồi mới xóa; bản chép trên máy được dọn qua hàng đợi việc.

> **Mẹo:** "Chờ app 2P Crew" nghĩa là app trên máy chưa nhận việc. Mở app trên Mac là xong.

### Docs {#docs}

{{shot:docs}}

Trang [Docs](/docs) là tài liệu của từng project, đọc từ bản mới nhất máy đã gửi lên (tự cập nhật khi nhánh chính có commit mới). Chưa máy nào gửi thì trang báo "Chưa có project nào có docs".

#### Cách làm

1. Chọn project ở ô **Project** trên thanh bên trái. Trang chủ docs của project (`index.md` hoặc `README.md`) mở sẵn; dưới tiêu đề bài là đường dẫn file, commit và giờ nhận.
2. Bấm trang trong cây (1) để đọc; bấm tên thư mục để thu gọn hay mở ra. Link trong bài mở thẳng trang đích; link hỏng báo "Liên kết hỏng". Bài có nhiều mục thì cột **Trên trang này** bên phải liệt kê các mục để nhảy tới.
3. Gõ từ khóa ở ô **Tìm trong tài liệu** (2).
4. Muốn gửi trang cho người khác thì chép địa chỉ trên thanh trình duyệt: link giữ đúng project và trang.

> **Mẹo:** file có dấu hiệu chứa mật khẩu hay token không bao giờ được gửi lên; chỉ tên file hiện ở mục "File bị bỏ do quét bí mật". Tab **Docs** trong một project cho cùng nội dung.

## Máy {#machines-group}

### Trang Máy {#machines roles=owner,operator}

{{shot:machines}}

Trang [Máy](/machines) có một thẻ cho mỗi máy Mac chạy agent, tự làm mới mỗi 30 giây.

- **Trực tuyến / Mất liên lạc** (4): máy gửi tin mỗi phút; quá 3 phút không có tin thì báo mất liên lạc.
- **Tải 1 phút / số CPU** và **RAM trống**, kèm biểu đồ 24 giờ. Tải vượt 8 thì agent chờ máy rảnh rồi mới chạy.
- **TCC đang chờ**: macOS đang hỏi quyền mà chưa ai bấm; agent bị chặn tới khi có người bấm **Cho phép** trên Mac.
- **Claude** (phiên bản, đăng nhập, gói), **Superpowers** (bản ghim), **App 2P Crew** (phiên bản, cập nhật). "Không rõ" là lần này máy không đọc được giá trị đó.
- Nhãn ghép (2): **Đã ghép <giờ>** là máy ghép tự động bằng app; **Đã gỡ <giờ>** là máy đã bị gỡ. Máy cũ dùng secret chung của company không có nhãn.
- Khối **Runtime** (3): mục [Runtime](#runtimes).

Bên dưới là **Hàng đợi việc trên máy**: việc máy cần làm (xem thư mục repo, dựng checkout, đồng bộ skill, kiểm tra project, cài runtime) đang **Đang chờ**, **Đang làm** hoặc **Lỗi**. Việc lỗi có nút thử lại.

{{roles:operator}}
> **Lưu ý:** ghép, gỡ máy và bật runtime do owner làm. Thấy máy mất liên lạc lâu thì báo owner.
{{/roles}}

### Ghép máy bằng app 2P Crew {#pair-machine roles=owner}

{{diagram:mac-pairing}}

Máy Mac mới được ghép vào company bằng app **2P Crew**, bạn **không cần dán key hay secret** nào. Sơ đồ trên là các bước của wizard trong app (không chụp được từ web).

#### Cách làm

1. Cài và mở app 2P Crew trên Mac. Wizard chạy lần lượt: **Kiểm tra máy** (macOS, Node, Tailscale, Claude Code) → gỡ app cũ nếu có → chuyển vào Applications → **Đăng nhập Paperclip**.
2. Ở bước đăng nhập, app mở trình duyệt; bấm **Cho phép** trên trang Crew.
3. **Chọn company** cho máy. Ô chọn để trống sẵn, nút Tiếp khóa tới khi bạn chọn: app không tự chọn company nào.
4. Bước **Máy này**: kiểm dòng **Ghép vào company: <tên>** rồi bấm **Ghép máy**. App tự tạo environment SSH `may-<tên máy>`, ghép máy với plugin Crew, nhận key riêng của máy (cất trong Keychain) và gửi bản tin thử.
5. Đi tiếp **Quyền ổ đĩa** (cấp Truy cập toàn bộ ổ đĩa), **sshd**, **Kiểm tra** đến **Xong**.
6. Mở trang [Máy](/machines): máy mới hiện với nhãn **Đã ghép <giờ>**.

#### Đổi company hoặc ghép lại

Ở màn **Xong** của app có khung **Company và máy** với nút **Đổi company / Ghép lại máy**. Dùng khi máy ghép nhầm company, hoặc bạn đã **Gỡ máy** trên web và muốn dùng lại. Bấm nút, app quay về bước đăng nhập; chọn company rồi đi lại các bước. Máy đã bị gỡ thì bước Máy hiện nút **Ghép lại máy này**: chỉ nút này mới ghép lại máy đã gỡ.

> **Mẹo:** màn Xong cảnh báo "Máy này không báo trạng thái lên Paperclip" khi bản tin gần nhất bị từ chối (ví dụ máy vừa bị gỡ). Bấm **Đổi company / Ghép lại máy** để sửa. Server báo "chưa có key Paperclip" thì nhờ người quản trị server; khối **Nhập tay (dự phòng)** chỉ dùng khi được hướng dẫn.

### Gỡ máy và ghép lại {#unpair-machine roles=owner}

{{shot:machine-unpair}}

Gỡ một máy để nó thôi nhận run mới. Máy khác không ảnh hưởng, environment không bị xóa.

#### Cách làm

1. Mở trang [Máy](/machines), tìm thẻ máy, bấm **Gỡ máy** (1 trên ảnh mục Trang Máy). Chỉ owner thấy nút này.
2. Đọc hộp xác nhận rồi bấm **Gỡ máy**:
   - máy **đã ghép**: Crew kiểm environment đúng là của máy (so IP Tailscale), lưu trữ environment rồi thu hồi key của máy;
   - máy **chưa ghép** (đang dùng secret chung của company): hộp xác nhận cảnh báo mạnh hơn; Crew chỉ chặn bản tin của máy, không lưu trữ environment.
3. Thẻ chuyển sang **Đã gỡ <giờ>** và hết nút.
4. Muốn dùng lại: mở app 2P Crew **trên chính máy đó**, bấm **Đổi company / Ghép lại máy**, rồi **Ghép lại máy này** ở bước Máy.

> **Mẹo:** lỗi ở bước nào thì trang hiện nguyên câu lỗi và nút còn đó; bấm lại là đi tiếp, không làm hỏng gì. Nút chỉ là giao diện: muốn chặn hẳn máy đã gỡ, thu hồi thêm key board mà app trên máy đó đang giữ.

## Hệ thống {#system}

### Thành viên {#members roles=owner}

{{shot:members}}

Trang [Thành viên](/members) chỉ owner thấy: danh sách thành viên và vai trò, lời mời Phòng Marketing, Phòng QC và yêu cầu tham gia.

#### Mời Phòng Marketing hoặc Phòng QC

1. Bấm **Mời Phòng Marketing** hoặc **Mời Phòng QC** (1), tùy người đó thuộc phòng nào. Đánh dấu các project người được mời sẽ xem (chọn được nhiều, hoặc bỏ trống để chọn sau), rồi bấm **Tạo link**. Chép link (dạng `…/paperclip/invite/…`) gửi cho người được mời. Link chỉ hiện một lần.
2. Người đó mở link, đăng ký hoặc đăng nhập rồi gửi yêu cầu tham gia.
3. Ở mục **Yêu cầu tham gia chờ duyệt**, dòng có nhãn **Lời mời Phòng Marketing** (hoặc **Lời mời Phòng QC**) kèm cột **Project sẽ cấp**: bấm **Duyệt**. Người đó hiện vai trò đúng phòng trên lời mời và thấy ngay các project đã chọn lúc mời, không phải chọn lại ở cột **Project được xem**. Nếu trang báo **Đã duyệt nhưng chưa cấp được project**, chọn project cho người đó ở cột **Project được xem**.

#### Đặt hoặc gỡ Phòng Marketing, Phòng QC

Thành viên Chỉ xem có nút **Đặt Phòng Marketing** và **Đặt Phòng QC**; người đang ở một phòng có nút **Gỡ Phòng Marketing** hoặc **Gỡ Phòng QC** (2), sau khi gỡ chỉ còn xem. Muốn đổi phòng thì gỡ rồi đặt phòng kia.

#### Chọn project mỗi người được xem

{{shot:project-access}}

Mọi thành viên trừ owner (Quản trị, Vận hành, Chỉ xem, Phòng Marketing, Phòng QC) chỉ thấy project bạn cấp. Người mới vào chưa thấy project nào. Owner luôn thấy tất cả, cột hiện **Tất cả**.

1. Ở cột **Project được xem**, bấm nút của người đó (1). Nút ghi tên project đã cấp, hoặc **Chưa có project**.
2. Đánh dấu hoặc bỏ dấu từng project (2), rồi bấm **Lưu** (3).
3. Người đó tải lại trang là thấy đúng các project đã chọn, kèm yêu cầu, số liệu Tổng quan và kết quả tìm kiếm của các project đó. Yêu cầu không thuộc project nào chỉ owner thấy.

> **Lưu ý:** đây là lớp ẩn của UI Crew. Ai mở thẳng giao diện Paperclip gốc hay API lõi vẫn đọc được. Riêng góp ý của Phòng Marketing và Phòng QC bị chặn ở server: không gửi được vào project chưa cấp, và owner không duyệt được góp ý của người đã bị gỡ quyền project đó.

> **Mẹo:** lời mời còn hiệu lực hiện ở bảng dưới kèm project đã chọn và giờ hết hạn; bấm **Thu hồi** để link hết dùng được.

### Cài đặt {#settings}

{{shot:settings}}

Trang [Cài đặt](/settings) có ba mục:
- **Hồ sơ**: sửa **Tên hiển thị** và **Ảnh đại diện**, bấm **Lưu hồ sơ** (có **Gỡ ảnh đại diện**).
- **Ngôn ngữ**: Tiếng Việt hoặc Tiếng Anh.
- **Thông tin hệ thống**: bản server, commit đang chạy, sao lưu gần nhất. Chỉ để xem.

### Giao diện Paperclip gốc {#stock-ui roles=owner}

{{shot:stock-ui}}

Crew chạy trên Paperclip. Giao diện gốc của Paperclip vẫn mở được ở đường `/paperclip/` cùng tên miền.

#### Cách làm

1. Bấm **Mở giao diện Paperclip gốc** (1) ở cuối thanh bên trái (hoặc trong menu tài khoản).
2. Tab mới mở đúng trang tương ứng ở giao diện gốc: đang xem một yêu cầu, project hay agent thì mở đúng đối tượng đó; trang khác thì mở trang chủ giao diện gốc.

> **Lưu ý:** chỉ owner thấy mục này. Dùng giao diện gốc để xem hoặc so sánh. Các thao tác Crew đã chặn có lý do (mục [Vì sao không có nút X](#missing-buttons)); làm ở giao diện gốc có thể làm hỏng luồng duyệt.

## Tra cứu {#reference}

### Vì sao không có nút X {#missing-buttons roles=owner,operator,viewer}

Quen Paperclip gốc mà không thấy một nút, đa số là cố ý:
- **Luật bảo vệ luồng duyệt.** Yêu cầu luôn đi qua Trợ Lý; không có ô đổi trạng thái tự do để bỏ qua review, kiểm tài liệu và đẩy code (bất khả kháng thì owner dùng **Ép Done** có lý do); cấu hình agent không bị sửa tùy ý.
- **Phân quyền chặt.** **Agent không tạo được agent khác**, không tự cấp quyền, **không sửa được project**. Việc đó chỉ người làm trên web, qua wizard có kiểm từng bước.
- **Thay bằng luồng đầy đủ.** Tạo project, tạo agent, thêm skill, gỡ project, gỡ agent có luồng riêng từng bước thay cho form hay nút xóa trơn.

Bảng dưới liệt kê từng tính năng Paperclip không có trong Crew, ở đâu trong Paperclip, vì sao, và cách làm thay. Mã lý do: **Crew không dùng**, **Bị luật chặn**, **Chưa có luồng**, **Để bản sau**.

{{missing}}

### Các dòng crew- trong bình luận {#crew-lines roles=owner,operator,viewer}

Bình luận của agent có các dòng bắt đầu bằng `crew-`: bằng chứng máy đọc được.

| Dòng | Ý nghĩa |
|---|---|
| `crew-plan root=… children=… bundles=…` | Kế hoạch của Trợ Lý: mấy yêu cầu con, mấy gói |
| `crew-bundle id=… seq=…` | Yêu cầu con thuộc gói nào, thứ mấy. Cùng gói thì một Executor làm lần lượt và nhớ ngữ cảnh |
| `crew-owner-child issue=CRE-…` | Trong kế hoạch: Trợ Lý đã nhận việc con do owner hoặc thành viên thêm (nút **Thêm việc con**) và giao executor ngay trên việc đó |
| `crew-model complexity=… model=… effort=… runtime=…` | Độ khó, model và runtime: Sonnet cho việc vừa và nhỏ, Opus cho việc lớn. `runtime=` là `claude_local`, `codex_local` hoặc `opencode_local`; không có là Claude |
| `crew-stack on=CRE-…` | Việc này xây tiếp trên code của việc kia |
| `crew-kind research` | Việc nghiên cứu, không sửa code |
| `crew-kind docs` | Việc viết tài liệu: chỉ sửa file tài liệu, không chạy test code |
| `crew-review … verdict=approved` | Reviewer đã duyệt |
| `crew-docs-check commit=… exit=0` | Integrator đã kiểm tài liệu trên code đã gộp; `exit=0` là đạt |
| `crew-merge sha=… pushed=pr pr=…` | Đã mở pull request vào nhánh chính, chờ owner bấm Merge trên GitHub |
| `crew-merge sha=… pushed=yes` | Đã đẩy thẳng lên nhánh chính (repo không ở GitHub) |
| `crew-assistant done children=…` | Trợ Lý xác nhận mọi yêu cầu con đã xong |

### Sự cố thường gặp {#troubleshooting}

| Bạn thấy | Nguyên nhân | Cách xử lý |
|---|---|---|
| "Sai email hoặc mật khẩu" | Gõ sai | Nhập lại; quên mật khẩu thì nhờ owner |
| Không thấy một mục ở thanh bên | Vai trò của bạn không dùng trang đó | Xem mục [2P Crew là gì](#what-is-crew) |
{{roles:owner,operator}}
| Bạn thấy | Nguyên nhân | Cách xử lý |
|---|---|---|
| Project không có trong hộp thoại Yêu cầu mới | Project chưa sẵn sàng | Tab **Sẵn sàng** của project, bấm **Làm tiếp** |
| Yêu cầu không chạy | Lưu nháp, hoặc Trợ Lý đang tạm dừng | Mở yêu cầu, bấm **Bắt đầu làm**; kiểm trang [Agent](/agents) |
| Yêu cầu đứng lâu | Máy quá tải (tải trên 8) | Đóng bớt app nặng trên Mac |
| **Bị chặn** | Chờ bạn trả lời, hoặc chờ yêu cầu con khác | Mở yêu cầu hoặc tab **Chờ tôi duyệt** của Hộp thư |
| docs **Lỗi** | Code đổi mà tài liệu chưa theo | Integrator tự sửa; lặp nhiều lần thì nhắn Trợ Lý |
| Thẻ máy **TCC đang chờ** | macOS xin quyền cho Claude Code | Bấm **Cho phép** trên Mac, hoặc System Settings → Privacy & Security → Files and Folders |
| Máy **Mất liên lạc** | Mac tắt, mất mạng, app chưa mở | Kiểm Mac, mạng, mở lại app 2P Crew |
| Việc trên máy ghi **Chờ app 2P Crew** | App chưa chạy | Mở app 2P Crew trên Mac |
| Agent báo hết quota | Gói Claude trên Mac hết hạn mức | Chờ hạn mức mở lại, hoặc nhờ owner bật Codex/OpenCode |
{{/roles}}
{{roles:owner}}
| Bạn thấy | Nguyên nhân | Cách xử lý |
|---|---|---|
| App báo "Máy này không báo trạng thái lên Paperclip" | Máy bị gỡ hoặc ghép nhầm company | **Đổi company / Ghép lại máy** trong app (mục [Ghép máy](#pair-machine)) |
| Khối Runtime ghi **Từ chối chuyển** | Không còn agent cùng máy rảnh và bật công tắc, hoặc đã chuyển đủ 2 lần | Bật công tắc ở trang Máy hoặc chờ quota |
| Wizard đứng ở một bước | Máy chưa làm xong, hoặc lỗi thật | Đọc lỗi, mở app trên Mac nếu có chữ "Chờ app", bấm **Chạy tiếp** |
{{/roles}}
{{roles:contributor}}
| Bạn thấy | Nguyên nhân | Cách xử lý |
|---|---|---|
| Mục ở **Bị từ chối** | Owner không đăng nội dung đó | Hỏi owner lý do, sửa và gửi yêu cầu mới |
| Mục nằm lâu ở **Chờ duyệt** | Owner chưa xem | Nhắn owner; agent chỉ làm sau khi được duyệt |
{{/roles}}

### Thuật ngữ {#glossary}

| Từ | Nghĩa |
|---|---|
| Yêu cầu (gốc) | Việc giao cho Trợ Lý |
| Yêu cầu con | Việc Trợ Lý tách ra từ yêu cầu gốc |
| Gói (bundle) | Nhóm yêu cầu con cùng vùng code, một Executor làm lần lượt |
| Run | Một lần agent chạy |
| Giai đoạn | Một bước trong luồng duyệt |
| Vòng sửa | Một lần Reviewer hoặc owner trả việc về sửa (tối đa 5) |
| Vai trò (project) | Trợ Lý, Executor, Reviewer, Integrator |
| Environment | Cấu hình cho agent biết chạy trên máy nào, thư mục nào |
| Checkout | Thư mục repo riêng của một agent trên máy |
| Sẵn sàng | Project hoặc agent đủ điều kiện nhận việc |
| Ghép máy | Gắn một Mac vào company bằng app 2P Crew; máy nhận key riêng |
| Superpowers | Bộ quy trình làm việc (brainstorm, lập kế hoạch, test trước) agent dùng |
| Phòng Marketing, Phòng QC | Thành viên chỉ xem, gửi yêu cầu và bình luận để owner duyệt; hai phòng cùng quyền |
