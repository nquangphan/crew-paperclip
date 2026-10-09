import { useState } from 'react';
import {
  AgentRow,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  AttachmentPicker,
  Avatar,
  AvatarFallback,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  Input,
  IssueRow,
  Kbd,
  Label,
  Logo,
  MarkdownView,
  PageHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  PropertyList,
  RunRow,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SidebarBody,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  Skeleton,
  Spinner,
  StageBadge,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  ThemeScope,
  ToggleSwitch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Transcript,
  Wizard,
} from '@/ds';
import { Inbox, LayoutDashboard, ListChecks } from '@/ds/icons';
import { CrewShowcase } from './crew-showcase';

function WidgetShowcase() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [search, setSearch] = useState('');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Tiêu đề trang"
        description="Mô tả ngắn của trang"
        actions={<Button size="sm">Hành động</Button>}
      />
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status="todo" />
        <StatusBadge status="in_progress" />
        <StatusBadge status="done" />
        <StatusBadge status="blocked" />
        <StatusBadge status="running" />
        <StatusBadge status="trang_thai_la" />
        <StageBadge stage="reviewer" />
        <StageBadge stage="owner" round={2} maxRounds={5} />
        <StageBadge stage="done" />
      </div>
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: 'Tìm yêu cầu' }}
        onReset={() => setSearch('')}
      >
        <Badge variant="outline">Bộ lọc khác</Badge>
      </FilterBar>
      <div className="flex flex-col">
        <IssueRow
          identifier="TPS-12"
          title="Thêm trang đăng nhập"
          status="in_progress"
          stage={<StageBadge stage="reviewer" />}
          assignee="Trợ Lý"
          href="#"
          onOpen={() => {}}
        />
        <IssueRow identifier="TPS-13" title="Yêu cầu con" status="todo" depth={1} href="#" onOpen={() => {}} />
        <RunRow
          id="3f2a9c1e-0000-0000-0000-000000000000"
          status="succeeded"
          agentName="executor"
          startedAt="2026-10-09T17:31:26Z"
          href="#"
          onOpen={() => {}}
        />
        <AgentRow name="tro-ly" roleLabel="Trợ Lý" status="idle" href="#" onOpen={() => {}} />
      </div>
      <PropertyList
        items={[
          { label: 'Trạng thái', value: <StatusBadge status="in_review" /> },
          { label: 'Project', value: '2ps-landing' },
          { label: 'Vòng sửa', value: '1/5' },
        ]}
      />
      <CrewShowcase />
      <MarkdownView
        markdown={
          '## Markdown\n\n**Đậm**, `mã`, [link ngoài](https://example.com).\n\n- [x] việc xong\n- [ ] việc chưa xong\n\n<img src=x onerror="alert(1)">'
        }
      />
      <Transcript
        entries={[
          { id: '1', role: 'user', text: 'Làm trang đăng nhập' },
          { id: '2', role: 'assistant', text: 'Đã tách 2 yêu cầu con.' },
          { id: '3', role: 'tool', text: 'git status --short' },
        ]}
      />
      <Wizard
        steps={[
          { id: 'inspect', title: 'Kiểm folder repo', state: 'done' },
          { id: 'project', title: 'Tạo project', state: 'done', detail: 'TPS · 2ps-landing' },
          { id: 'checkouts', title: 'Dựng checkout trên máy', state: 'failed', detail: 'git_failed' },
          { id: 'environments', title: 'Tạo environment', state: 'pending' },
        ]}
        error="Máy báo lỗi: checkout đã tồn tại"
        onResume={() => {}}
      />
      <AttachmentPicker
        onFiles={() => {}}
        warnFor={(name) => (name.endsWith('.zip') ? 'agent không đọc file nén' : null)}
      />
      <div>
        <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
          Mở ConfirmDialog
        </Button>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Hủy yêu cầu?"
          body="Run đang chạy trên máy sẽ dừng."
          confirmLabel="Hủy yêu cầu"
          destructive
          requireText="TPS-12"
          onConfirm={() => setConfirmOpen(false)}
        />
      </div>
      <div className="flex flex-col">
        <SidebarHeader>
          <Logo />
        </SidebarHeader>
        <SidebarBody label="Điều hướng mẫu">
          <SidebarItem href="#" label="Tổng quan" icon={<LayoutDashboard aria-hidden />} active />
          <SidebarItem href="#" label="Hộp thư" icon={<Inbox aria-hidden />} badge={4} />
          <SidebarItem href="#" label="Yêu cầu" icon={<ListChecks aria-hidden />} />
        </SidebarBody>
        <SidebarFooter>
          <Kbd>⌘K</Kbd>
        </SidebarFooter>
      </div>
    </div>
  );
}

function Showcase({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <ThemeScope theme={theme}>
      <TooltipProvider>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Logo />
            <Badge>{theme === 'dark' ? 'Theme tối' : 'Theme sáng'}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button>Mặc định</Button>
            <Button variant="cta">CTA</Button>
            <Button variant="secondary">Phụ</Button>
            <Button variant="outline">Viền</Button>
            <Button variant="ghost">Mờ</Button>
            <Button variant="link">Liên kết</Button>
            <Button variant="destructive">Xóa</Button>
            <Button disabled>Vô hiệu</Button>
            <Spinner />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Mặc định</Badge>
            <Badge variant="secondary">Phụ</Badge>
            <Badge variant="outline">Viền</Badge>
            <Badge variant="destructive">Lỗi</Badge>
            <Avatar>
              <AvatarFallback>2P</AvatarFallback>
            </Avatar>
            <ToggleSwitch checked onCheckedChange={() => {}} aria-label="Bật" />
            <Checkbox aria-label="Chọn" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Tên project" hint="Tối đa 60 ký tự">
              <Input placeholder="Nhập tên" />
            </Field>
            <Field label="Mã project" error="Mã đã tồn tại">
              <Input defaultValue="CREW" aria-invalid />
            </Field>
            <Field label="Mô tả">
              <Textarea placeholder="Mô tả ngắn" />
            </Field>
            <div className="flex flex-col gap-2">
              <Label>Model</Label>
              <Select defaultValue="opus">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="opus">Opus</SelectItem>
                  <SelectItem value="sonnet">Sonnet</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Separator />
          <Tabs defaultValue="a">
            <TabsList>
              <TabsTrigger value="a">Tổng quan</TabsTrigger>
              <TabsTrigger value="b">Yêu cầu</TabsTrigger>
            </TabsList>
            <TabsContent value="a">Nội dung tổng quan</TabsContent>
            <TabsContent value="b">Nội dung yêu cầu</TabsContent>
          </Tabs>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Project</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Chi tiết</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <Card>
            <CardHeader>
              <CardTitle>Thẻ</CardTitle>
              <CardDescription>Mô tả thẻ</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mã</TableHead>
                    <TableHead>Tiêu đề</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>CREW-1</TableCell>
                    <TableCell>Dựng khung UI</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <div className="flex flex-wrap items-center gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Hộp thoại</DialogTitle>
                  <DialogDescription>Nội dung mô tả</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button>Đồng ý</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline">Xác nhận</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Chắc chắn?</AlertDialogTitle>
                  <AlertDialogDescription>Thao tác không hoàn tác được.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Hủy</AlertDialogCancel>
                  <AlertDialogAction>Tiếp tục</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Sheet</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Ngăn bên</SheetTitle>
                  <SheetDescription>Nội dung ngăn bên</SheetDescription>
                </SheetHeader>
              </SheetContent>
            </Sheet>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">Popover</Button>
              </PopoverTrigger>
              <PopoverContent>Nội dung popover</PopoverContent>
            </Popover>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Menu</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>Sửa</DropdownMenuItem>
                <DropdownMenuItem>Xóa</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline">Tooltip</Button>
              </TooltipTrigger>
              <TooltipContent>Chú thích</TooltipContent>
            </Tooltip>
          </div>
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost">Mở rộng</Button>
            </CollapsibleTrigger>
            <CollapsibleContent>Nội dung thu gọn</CollapsibleContent>
          </Collapsible>
          <Command>
            <CommandInput placeholder="Tìm lệnh" />
            <CommandList>
              <CommandEmpty>Không có kết quả</CommandEmpty>
              <CommandItem>Thêm project</CommandItem>
              <CommandItem>Tạo agent</CommandItem>
            </CommandList>
          </Command>
          <ScrollArea className="h-full">
            <Skeleton />
          </ScrollArea>
          <EmptyState title="Chưa có yêu cầu" description="Tạo yêu cầu đầu tiên cho project này." />
          <ErrorState title="Không tải được" message={'HTTP 500\n<b>không render HTML</b>'} onRetry={() => {}} />
          <Separator />
          <WidgetShowcase />
        </div>
      </TooltipProvider>
    </ThemeScope>
  );
}

export function DsPage() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Showcase theme="light" />
      <Showcase theme="dark" />
    </div>
  );
}
