<script lang="ts" setup>
import type {
  CheckboxValueType,
  UploadFile,
  UploadFiles,
  UploadProps,
  UploadRawFile,
} from 'element-plus';

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

import {
  SvgCloseIcon,
  SvgDocumentDocTrashBinIcon,
  SvgExpandEditorIcon,
} from '@vben/icons';

import {
  ElButton,
  ElCheckbox,
  ElInput,
  ElOption,
  ElSelect,
  ElTooltip,
  ElUpload,
  genFileId,
} from 'element-plus';

import { getEnumDescription } from '#/utils/enumexpand';

interface ParamItem {
  __rowKey?: string;
  enabled: boolean;
  name: string;
  value: any;
  fileList?: UploadFile[];
  description?: string;
  type?: string;
  format?: string;
  required?: boolean;
  enum?: number[] | string[];
  contentType?: string;
  schema?: {
    enum?: number[] | string[];
    format?: string;
    items?: {
      enum?: number[] | string[];
      format?: string;
    };
    type?: string;
    'x-nextdoc4j-enum'?: {
      items?: Array<{ description?: string; value: string }>;
    };
  };
}

type DraftInputField = 'description' | 'name' | 'value';

const props = withDefaults(
  defineProps<{
    allowDelete?: boolean;
    showAddButton?: boolean;
    showContentType?: boolean;
    showDeleteInDescription?: boolean;
    showDescriptionColumn?: boolean;
    showSelectionColumn?: boolean;
    tableData: ParamItem[];
  }>(),
  {
    allowDelete: true,
    showAddButton: true,
    showContentType: false,
    showDeleteInDescription: false,
    showDescriptionColumn: false,
    showSelectionColumn: true,
  },
);

const contentTypeOptions = [
  { label: 'application/octet-stream', value: 'application/octet-stream' },
  { label: 'application/json', value: 'application/json' },
  { label: 'application/xml', value: 'application/xml' },
  { label: 'text/plain', value: 'text/plain' },
  { label: 'text/html', value: 'text/html' },
];

const showInlineDelete = computed(() => {
  return props.allowDelete && !props.showDeleteInDescription;
});

const showDescriptionDelete = computed(() => {
  return props.allowDelete && props.showDeleteInDescription;
});
let paramRowKeySeed = 0;

const createParamRowKey = () => `params-row-${paramRowKeySeed++}`;

function getRowKey(row: ParamItem, index: number) {
  if (!row.__rowKey) {
    row.__rowKey = `${createParamRowKey()}-${index}`;
  }
  return row.__rowKey;
}

const gridTemplateColumns = computed(() => {
  const columns: string[] = [];
  if (props.showSelectionColumn) {
    columns.push('34px');
  }
  columns.push('minmax(0, 0.92fr)');

  if (props.showDescriptionColumn && props.showContentType) {
    columns.push('minmax(0, 1fr)', 'minmax(0, 0.9fr)', 'minmax(0, 0.86fr)');
    return columns.join(' ');
  }

  columns.push(
    props.showDescriptionColumn || props.showContentType
      ? 'minmax(0, 1.05fr)'
      : 'minmax(0, 1.18fr)',
  );

  if (props.showDescriptionColumn) {
    columns.push('minmax(0, 0.82fr)');
  }
  if (props.showContentType) {
    columns.push('minmax(0, 0.92fr)');
  }
  return columns.join(' ');
});

const rowStyle = computed(() => ({
  gridTemplateColumns: gridTemplateColumns.value,
}));

const allChecked = computed({
  get: () => !props.tableData.some((item) => !item.enabled),
  set: (value: boolean) => {
    props.tableData.forEach((item) => {
      if (!item.required) {
        item.enabled = value;
      }
    });
  },
});

function handleChange(value: CheckboxValueType) {
  allChecked.value = value as boolean;
}

function isEnumParam(row: ParamItem) {
  return (
    (row.enum && row.enum.length > 0) ||
    (row.schema?.enum && row.schema.enum.length > 0) ||
    (row.schema?.items?.enum && row.schema.items.enum.length > 0)
  );
}

function getEnumOptions(row: ParamItem) {
  const enumValues: (number | string)[] =
    row.enum || row.schema?.enum || row.schema?.items?.enum || [];
  return enumValues.map((value) => ({
    label: String(value),
    value,
    description: undefined,
  }));
}

function getPlaceholder(row: ParamItem) {
  if (row.description) return row.description;
  if (row.type) return row.type;
  return '请输入参数值';
}

function getDescription(row: ParamItem) {
  // 拼接原始描述与扩展枚举（x-nextdoc4j-enum）说明，便于在调试表格中完整查看
  const enumDesc = getEnumDescription(
    row.description?.trim() || '',
    row.schema,
  ).trim();
  return enumDesc;
}

// 描述列文案是否溢出（仅在文本被省略号截断时才展示浮窗），key 为行的 __rowKey
const descriptionTruncated = ref<Record<string, boolean>>({});

/** 鼠标进入描述文本时测量是否发生截断，决定是否需要展示浮窗 */
function handleDescriptionHover(
  event: MouseEvent,
  row: ParamItem,
  index: number,
) {
  const target = event.currentTarget as HTMLElement | null;
  if (!target) {
    return;
  }
  const key = getRowKey(row, index);
  descriptionTruncated.value = {
    ...descriptionTruncated.value,
    [key]: target.scrollWidth > target.clientWidth,
  };
}

function normalizeEnumRowValue(row: ParamItem) {
  const options = getEnumOptions(row).map((item) => item.value);
  if (options.length <= 0) {
    return;
  }

  const currentValue = row.value;
  if (
    currentValue === '' ||
    currentValue === null ||
    currentValue === undefined
  ) {
    row.value = options[0];
    return;
  }

  if (options.includes(currentValue)) {
    return;
  }

  const matchedOption = options.find(
    (option) => String(option) === String(currentValue),
  );
  if (matchedOption !== undefined) {
    row.value = matchedOption;
    return;
  }

  row.value = options[0];
}

function remove(index: number) {
  // eslint-disable-next-line vue/no-mutating-props
  props.tableData.splice(index, 1);
}

// ===== 参数值编辑弹窗：长参数值在内联输入框中体验差，提供大文本域编辑 =====
const valueEditorVisible = ref(false);
const valueEditorDraft = ref('');
// 仅持有当前编辑行引用，确认后写回该行 value；不跨行复用，避免错位
const valueEditorRow = ref<null | ParamItem>(null);
// 组件根节点引用，用于向上查找「请求参数」内容区作为覆盖层挂载点
const wrapRef = ref<HTMLElement | null>(null);
// 覆盖层 Teleport 目标：优先挂到整个调试布局，未找到时回退到「请求参数」内容区
const editorTeleportTarget = ref<HTMLElement | null>(null);

/**
 * 用途：打开参数值编辑覆盖层，并将当前行参数值载入草稿。
 * 参数说明：row 为当前需要编辑的参数行数据。
 * 返回值说明：无返回值，仅更新编辑覆盖层状态。
 */
function openValueEditor(row: ParamItem) {
  valueEditorRow.value = row;
  valueEditorDraft.value = `${row.value ?? ''}`;
  const debugLayout = wrapRef.value?.closest<HTMLElement>('.debug-layout');
  const tabsWrap = wrapRef.value?.closest<HTMLElement>('.debug-tabs-wrap');
  editorTeleportTarget.value = debugLayout ?? tabsWrap ?? null;
  valueEditorVisible.value = true;
}

/**
 * 用途：关闭参数值编辑覆盖层并清理临时编辑状态。
 * 参数说明：无参数。
 * 返回值说明：无返回值。
 */
function closeValueEditor() {
  valueEditorVisible.value = false;
  valueEditorRow.value = null;
  valueEditorDraft.value = '';
}

/**
 * 用途：确认参数值编辑，将草稿写回当前行。
 * 参数说明：无参数。
 * 返回值说明：无返回值，写回后自动关闭编辑覆盖层。
 */
function confirmValueEditor() {
  if (valueEditorRow.value) {
    valueEditorRow.value.value = valueEditorDraft.value;
  }
  closeValueEditor();
}

// 末尾草稿行：替代「添加参数」按钮，用户在末尾空白行任意填写即自动新增正式行。
// 草稿行独立于 tableData，避免空行干扰参数数量统计与缓存持久化。
/**
 * 用途：创建末尾草稿行数据。
 * 参数说明：无参数。
 * 返回值说明：返回带唯一行标识的空参数行。
 */
const createDraftRow = (): ParamItem => ({
  __rowKey: createParamRowKey(),
  name: '',
  value: '',
  enabled: true,
  fileList: [],
});

const draftRow = ref<ParamItem>(createDraftRow());
let focusRetryTimers: number[] = [];

const displayRows = computed(() => {
  return props.showAddButton
    ? [...props.tableData, draftRow.value]
    : props.tableData;
});

/**
 * 用途：判断草稿行是否已经填写了可提交内容。
 * 参数说明：row 为当前末尾草稿行数据。
 * 返回值说明：存在参数名或参数值时返回 true。
 */
function hasDraftRowContent(row: ParamItem) {
  return Boolean(row.name?.trim() || `${row.value ?? ''}`.trim());
}

/**
 * 用途：判断当前行是否为末尾草稿行。
 * 参数说明：row 为当前渲染行数据。
 * 返回值说明：当前行是草稿行对象时返回 true。
 */
function isDraftRow(row: ParamItem) {
  return props.showAddButton && row === draftRow.value;
}

/**
 * 用途：清理提交草稿行后的焦点重试计时器。
 * 参数说明：无参数。
 * 返回值说明：无返回值，仅取消尚未执行的焦点重试。
 */
function clearFocusRetryTimers() {
  focusRetryTimers.forEach((timer) => {
    window.clearTimeout(timer);
  });
  focusRetryTimers = [];
}

/**
 * 用途：查找刚由草稿行提交出来的正式参数行输入框。
 * 参数说明：rowKey 为正式行唯一标识，field 为需要定位的字段。
 * 返回值说明：找到时返回对应原生 input 元素，否则返回 null。
 */
function findCommittedDraftInput(rowKey: string, field: DraftInputField) {
  return (
    wrapRef.value?.querySelector<HTMLInputElement>(
      `[data-param-row-key="${rowKey}"][data-param-field="${field}"] input`,
    ) ?? null
  );
}

/**
 * 用途：将焦点恢复到刚由草稿行提交出来的正式参数行字段。
 * 参数说明：rowKey 为正式行唯一标识，field 为需要恢复焦点的字段。
 * 返回值说明：无返回值，仅在 DOM 更新后恢复输入焦点和光标位置。
 */
function focusCommittedDraftField(rowKey: string, field: DraftInputField) {
  clearFocusRetryTimers();
  const focusInput = () => {
    const input = findCommittedDraftInput(rowKey, field);
    if (!input) {
      return false;
    }
    input.focus();
    const cursorPosition = input.value.length;
    input.setSelectionRange(cursorPosition, cursorPosition);
    clearFocusRetryTimers();
    return true;
  };

  void nextTick(() => {
    if (focusInput()) {
      return;
    }
    window.requestAnimationFrame(() => {
      if (focusInput()) {
        return;
      }
      [30, 80, 160].forEach((delay) => {
        const timer = window.setTimeout(() => {
          focusInput();
        }, delay);
        focusRetryTimers.push(timer);
      });
    });
  });
}

/**
 * 用途：更新正式参数行字段。
 * 参数说明：row 为当前正式行，field 为字段名，value 为输入后的字段值。
 * 返回值说明：无返回值，仅更新当前字段。
 */
function handleCommittedInput(
  row: ParamItem,
  field: DraftInputField,
  value: string,
) {
  row[field] = value;
}

/**
 * 用途：将草稿行提交为正式行，并重置草稿行以便继续录入。
 * 参数说明：field 为触发提交的字段，用于提交后恢复焦点。
 * 返回值说明：无返回值，会向参数列表追加一行并重置草稿行。
 */
function commitDraftRow(field: DraftInputField) {
  const rowKey = draftRow.value.__rowKey || createParamRowKey();
  const row = {
    ...draftRow.value,
    __rowKey: rowKey,
  };
  // eslint-disable-next-line vue/no-mutating-props
  props.tableData.push(row);
  draftRow.value = createDraftRow();
  focusCommittedDraftField(rowKey, field);
}

/**
 * 用途：处理草稿行字段输入，首次填写后自动提交成正式行。
 * 参数说明：field 为正在输入的字段，value 为输入后的字段值。
 * 返回值说明：无返回值，会在草稿行有内容时自动新增下一空行。
 */
function handleDraftInput(field: DraftInputField, value: string) {
  draftRow.value[field] = value;
  if (hasDraftRowContent(draftRow.value)) {
    commitDraftRow(field);
  }
}

/**
 * 用途：处理参数表字段输入，草稿行负责自动提交，正式行直接更新字段。
 * 参数说明：row 为当前行数据，index 为行索引，field 为字段名，value 为输入后的字段值。
 * 返回值说明：无返回值，会根据行类型更新草稿行或正式参数行。
 */
function handleParamFieldInput(
  row: ParamItem,
  field: DraftInputField,
  value: string,
) {
  if (isDraftRow(row)) {
    handleDraftInput(field, value);
    return;
  }
  handleCommittedInput(row, field, value);
}

onBeforeUnmount(() => {
  clearFocusRetryTimers();
});

function handleUpload(
  _uploadFile: UploadFile,
  uploadFiles: UploadFiles,
  row: ParamItem,
) {
  syncUploadValue(row, uploadFiles);
}

function syncUploadValue(row: ParamItem, uploadFiles: UploadFiles) {
  row.fileList = [...uploadFiles];
  const rawFiles = uploadFiles
    .filter((file) => file.raw)
    .map((file) => file.raw) as UploadRawFile[];
  if (rawFiles.length <= 0) {
    row.value = '';
    return;
  }
  row.value = row.type === 'array' ? rawFiles : rawFiles[0];
}

function removeUploadedFile(file: UploadFile, row: ParamItem) {
  const nextFiles = (row.fileList || []).filter(
    (item) => item.uid !== file.uid,
  );
  syncUploadValue(row, nextFiles);
}

const handleExceed = (
  files: Parameters<NonNullable<UploadProps['onExceed']>>[0],
  _uploadFiles: Parameters<NonNullable<UploadProps['onExceed']>>[1],
  row: ParamItem,
) => {
  const file = files[0] as undefined | UploadRawFile;
  if (!file) {
    return;
  }
  file.uid = genFileId();
  row.fileList = [
    {
      name: file.name,
      raw: file,
      size: file.size,
      status: 'ready',
      uid: file.uid,
    } as UploadFile,
  ];
  row.value = row.type === 'array' ? [file] : file;
};

watch(
  () => props.tableData,
  (rows) => {
    rows.forEach((row) => {
      if (isEnumParam(row)) {
        normalizeEnumRowValue(row);
      }
    });
  },
  { deep: true, immediate: true },
);
</script>

<template>
  <div ref="wrapRef" class="params-table-wrap">
    <div class="params-table-shell">
      <div class="params-grid-table">
        <div
          class="params-grid-table__row params-grid-table__row--header"
          :style="rowStyle"
        >
          <div
            v-if="showSelectionColumn"
            class="params-grid-table__cell params-grid-table__cell--selection params-grid-table__cell--header"
          >
            <ElCheckbox v-model="allChecked" @change="handleChange" />
          </div>
          <div class="params-grid-table__cell params-grid-table__cell--header">
            参数名
          </div>
          <div class="params-grid-table__cell params-grid-table__cell--header">
            参数值
          </div>
          <div
            v-if="showContentType"
            class="params-grid-table__cell params-grid-table__cell--header"
          >
            内容类型
          </div>
          <div
            v-if="showDescriptionColumn"
            class="params-grid-table__cell params-grid-table__cell--header"
          >
            描述
          </div>
        </div>

        <div
          v-for="(row, index) in displayRows"
          :key="getRowKey(row, index)"
          class="params-grid-table__row"
          :class="{ 'params-grid-table__row--draft': isDraftRow(row) }"
          :style="rowStyle"
        >
          <div
            v-if="showSelectionColumn"
            class="params-grid-table__cell params-grid-table__cell--selection params-grid-table__cell--body"
          >
            <ElCheckbox v-model="row.enabled" :disabled="isDraftRow(row)" />
          </div>

          <div class="params-grid-table__cell params-grid-table__cell--body">
            <ElInput
              :model-value="row.name"
              :placeholder="isDraftRow(row) ? '添加参数名' : '参数名'"
              :data-param-row-key="row.__rowKey"
              data-param-field="name"
              @update:model-value="
                (value) => handleParamFieldInput(row, 'name', value)
              "
            />
          </div>

          <div class="params-grid-table__cell params-grid-table__cell--body">
            <div
              v-if="row.format === 'binary'"
              class="params-grid-table__control params-grid-table__control--upload"
            >
              <ElUpload
                v-model:file-list="row.fileList"
                action="#"
                :auto-upload="false"
                :on-change="(file, files) => handleUpload(file, files, row)"
                :on-remove="(file, files) => handleUpload(file, files, row)"
                :multiple="row.type === 'array'"
                :limit="row.type === 'array' ? 99 : 1"
                :on-exceed="
                  (files, uploadFiles) => handleExceed(files, uploadFiles, row)
                "
              >
                <ElButton plain size="small"> 上传 </ElButton>
                <template #file="{ file }">
                  <div class="el-upload-list__item-info param-upload-file">
                    <span
                      class="el-upload-list__item-name param-upload-file__main"
                    >
                      <span
                        class="el-icon el-icon--document"
                        aria-hidden="true"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 1024 1024"
                        >
                          <path
                            fill="currentColor"
                            d="M832 384H576V128H192v768h640zm-26.496-64L640 154.496V320zM160 64h480l256 256v608a32 32 0 0 1-32 32H160a32 32 0 0 1-32-32V96a32 32 0 0 1 32-32m160 448h384v64H320zm0-192h160v64H320zm0 384h384v64H320z"
                          />
                        </svg>
                      </span>
                      <ElTooltip :content="file.name" placement="top">
                        <span
                          class="el-upload-list__item-file-name param-upload-file__name"
                        >
                          {{ file.name }}
                        </span>
                      </ElTooltip>
                    </span>
                  </div>
                  <span
                    class="el-icon el-icon--close param-upload-file__close"
                    @click.stop="removeUploadedFile(file, row)"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 1024 1024"
                    >
                      <path
                        fill="currentColor"
                        d="M764.288 214.592 512 466.88 259.712 214.592a31.936 31.936 0 0 0-45.12 45.12L466.752 512 214.528 764.224a31.936 31.936 0 1 0 45.12 45.184L512 557.184l252.288 252.288a31.936 31.936 0 0 0 45.12-45.12L557.12 512.064l252.288-252.352a31.936 31.936 0 1 0-45.12-45.184z"
                      />
                    </svg>
                  </span>
                </template>
              </ElUpload>
              <button
                v-if="showInlineDelete"
                type="button"
                class="param-inline-delete"
                @click="remove(index)"
              >
                <SvgCloseIcon class="param-inline-delete__icon" />
              </button>
            </div>

            <div
              v-else-if="isEnumParam(row)"
              class="params-grid-table__control"
            >
              <ElSelect
                v-model="row.value"
                placeholder="请选择枚举值"
                size="small"
                class="w-full"
                filterable
              >
                <ElOption
                  v-for="option in getEnumOptions(row)"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                >
                  <span>{{ option.label }}</span>
                  <span
                    v-if="option.description"
                    class="ml-2 text-xs text-gray-400"
                  >
                    {{ option.description }}
                  </span>
                </ElOption>
              </ElSelect>
              <button
                v-if="showInlineDelete"
                type="button"
                class="param-inline-delete"
                @click="remove(index)"
              >
                <SvgCloseIcon class="param-inline-delete__icon" />
              </button>
            </div>

            <div v-else class="params-grid-table__control">
              <ElInput
                :model-value="row.value"
                :placeholder="
                  isDraftRow(row) ? '添加参数值' : getPlaceholder(row)
                "
                :data-param-row-key="row.__rowKey"
                data-param-field="value"
                @update:model-value="
                  (value) => handleParamFieldInput(row, 'value', value)
                "
              />
              <button
                v-if="!isDraftRow(row)"
                type="button"
                class="param-edit-button"
                title="编辑参数值"
                @click="openValueEditor(row)"
              >
                <SvgExpandEditorIcon class="param-edit-icon" />
              </button>
              <button
                v-if="showInlineDelete && !isDraftRow(row)"
                type="button"
                class="param-inline-delete"
                @click="remove(index)"
              >
                <SvgCloseIcon class="param-inline-delete__icon" />
              </button>
            </div>
          </div>

          <div
            v-if="showContentType"
            class="params-grid-table__cell params-grid-table__cell--body"
          >
            <ElSelect
              v-if="!isDraftRow(row)"
              v-model="row.contentType"
              placeholder="自动"
              clearable
              size="small"
              class="w-full"
            >
              <ElOption
                v-for="option in contentTypeOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </ElSelect>
          </div>

          <div
            v-if="showDescriptionColumn"
            class="params-grid-table__cell params-grid-table__cell--body"
          >
            <ElInput
              v-if="isDraftRow(row)"
              :model-value="row.description"
              placeholder="可选说明"
              :data-param-row-key="row.__rowKey"
              data-param-field="description"
              @update:model-value="
                (value) => handleParamFieldInput(row, 'description', value)
              "
            />
            <div v-else class="param-description-cell">
              <span class="param-description-main">
                <ElTooltip
                  v-if="getDescription(row)"
                  :content="getDescription(row)"
                  placement="top"
                  :disabled="!descriptionTruncated[getRowKey(row, index)]"
                >
                  <span
                    class="param-description-text"
                    @mouseenter="handleDescriptionHover($event, row, index)"
                  >
                    {{ getDescription(row) }}
                  </span>
                </ElTooltip>
                <span v-else class="param-description-text">-</span>
              </span>
              <button
                v-if="showDescriptionDelete"
                type="button"
                class="param-delete-button"
                @click="remove(index)"
              >
                <SvgDocumentDocTrashBinIcon class="param-delete-icon" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 参数值编辑覆盖层：覆盖整个在线调试区，避免请求参数面板过窄时挤压编辑器。 -->
    <Teleport :to="editorTeleportTarget" :disabled="!editorTeleportTarget">
      <div v-if="valueEditorVisible" class="param-editor-overlay">
        <div class="param-editor">
          <div class="param-editor__header">编辑参数值</div>
          <textarea
            v-model="valueEditorDraft"
            class="param-editor__textarea"
            placeholder="在此输入或粘贴完整的参数值"
          ></textarea>
          <div class="param-editor__footer">
            <ElButton size="small" @click="closeValueEditor">取消</ElButton>
            <ElButton size="small" type="primary" @click="confirmValueEditor">
              确定
            </ElButton>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style lang="scss" scoped>
.params-table-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
}

.params-table-shell {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  background: var(--debug-surface, var(--el-bg-color));
  border: 1px solid
    var(--debug-border, var(--el-border-color-light, var(--el-border-color)));
  border-radius: calc(var(--radius) * 0.72);
}

.params-grid-table {
  width: 100%;
  min-width: 0;
}

.params-grid-table__row {
  display: grid;
  width: 100%;
  min-width: 0;
  background: var(--debug-surface, var(--el-bg-color));
  transition: background-color 0.2s ease;
}

.params-grid-table__row:not(.params-grid-table__row--header):not(
    .params-grid-table__row--draft
  ):hover {
  background: var(--el-table-row-hover-bg-color, var(--el-fill-color));
}

.params-grid-table__row--header {
  background: var(--debug-soft-bg-strong, var(--el-fill-color-light));
}

.params-grid-table__row:not(:last-child) .params-grid-table__cell {
  border-bottom: 1px solid
    var(--debug-border, var(--el-border-color-light, var(--el-border-color)));
}

.params-grid-table__cell {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 6px 8px;
  background: inherit;
  border-right: 1px solid
    var(--debug-border, var(--el-border-color-light, var(--el-border-color)));
}

.params-grid-table__cell:last-child {
  border-right: none;
}

.params-grid-table__cell--header {
  min-height: 34px;
  padding-top: 5px;
  padding-bottom: 5px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.params-grid-table__cell--body {
  min-height: 34px;
  padding-top: 4px;
  padding-bottom: 4px;
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.params-grid-table__cell--selection {
  justify-content: center;
  padding: 0;
}

.params-grid-table__control {
  display: flex;
  gap: 6px;
  align-items: center;
  width: 100%;
  min-width: 0;
}

.params-grid-table__control--upload {
  flex-direction: column;
  align-items: stretch;
}

.params-grid-table__control--upload :deep(.el-upload) {
  align-self: flex-start;
}

.params-grid-table__control--upload :deep(.el-upload-list) {
  width: 100%;
  min-width: 0;
  margin-top: 6px;
}

.params-grid-table__control--upload :deep(.el-upload-list__item) {
  min-width: 0;
  margin-bottom: 0;
}

.params-grid-table__control--upload :deep(.el-upload-list__item-info) {
  width: calc(100% - 30px);
  min-width: 0;
}

.params-grid-table__control--upload :deep(.el-upload-list__item-name) {
  width: 100%;
  min-width: 0;
}

.params-grid-table__control--upload :deep(.el-upload-list__item-file-name) {
  display: inline-block;
  width: 100%;
  min-width: 0;
}

.param-upload-file {
  min-width: 0;
}

.param-upload-file__main {
  width: 100%;
  min-width: 0;
}

.param-upload-file__main :deep(.el-tooltip__trigger) {
  display: inline-flex;
  flex: 1 1 auto;
  min-width: 0;
}

.param-upload-file__name {
  display: inline-block;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.params-grid-table__control :deep(.el-input),
.params-grid-table__control :deep(.el-select),
.params-grid-table__cell :deep(.el-input),
.params-grid-table__cell :deep(.el-select),
.params-grid-table__cell :deep(.el-select__wrapper),
.params-grid-table__cell :deep(.el-input__wrapper) {
  width: 100%;
  min-width: 0;
}

.params-grid-table__cell :deep(.el-input__wrapper),
.params-grid-table__cell :deep(.el-select__wrapper) {
  min-height: 24px;
  padding: 0;
  background: transparent;
  border: none !important;
  border-radius: 0;
  box-shadow: none !important;
}

.params-grid-table__cell :deep(.el-input__wrapper::before),
.params-grid-table__cell :deep(.el-input__wrapper::after),
.params-grid-table__cell :deep(.el-select__wrapper::before),
.params-grid-table__cell :deep(.el-select__wrapper::after) {
  display: none !important;
}

.params-grid-table__cell :deep(.el-input__inner),
.params-grid-table__cell :deep(.el-select__placeholder),
.params-grid-table__cell :deep(.el-select__selected-item),
.params-grid-table__cell :deep(.el-input__count-inner) {
  font-size: 14px;
  line-height: 1.3;
}

.params-grid-table__cell :deep(.el-input__inner) {
  color: var(--el-text-color-primary);
}

.params-grid-table__cell :deep(.el-select__wrapper) {
  color: var(--el-text-color-primary);
}

.params-grid-table__cell :deep(.el-select__selected-item),
.params-grid-table__cell :deep(.el-select__selected-item > span),
.params-grid-table__cell
  :deep(.el-select__selected-item.el-select__placeholder:not(.is-transparent)),
.params-grid-table__cell
  :deep(
    .el-select__selected-item.el-select__placeholder:not(.is-transparent) > span
  ) {
  color: var(--el-text-color-primary) !important;
}

.params-grid-table__cell :deep(.el-input__inner::placeholder),
.params-grid-table__cell :deep(.el-select__placeholder.is-transparent),
.params-grid-table__cell :deep(.el-select__placeholder.is-transparent > span) {
  color: var(--el-text-color-placeholder);
}

.params-grid-table__cell :deep(.el-checkbox) {
  --el-checkbox-input-width: 14px;
  --el-checkbox-input-height: 14px;
}

/* 末尾草稿行：弱化展示，提示用户此处可直接输入新增参数 */
.params-grid-table__row--draft {
  background: color-mix(
    in srgb,
    var(--debug-soft-bg-strong, var(--el-fill-color-light)) 50%,
    transparent
  );
}

.params-grid-table__row--draft .param-description-text,
.params-grid-table__row--draft :deep(.el-input__inner::placeholder) {
  color: var(--el-text-color-placeholder);
}

.param-description-cell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  width: 100%;
  min-width: 0;
}

.param-description-main {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
}

.param-description-main :deep(.el-tooltip__trigger) {
  flex: 1 1 auto;
  min-width: 0;
}

.param-description-text {
  display: inline-block;
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
  white-space: nowrap;
}

.param-inline-delete {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: calc(var(--radius) * 0.62);
}

.param-inline-delete:hover {
  color: var(--el-color-danger);
  background: color-mix(
    in srgb,
    var(--el-color-danger-light-9) 70%,
    transparent
  );
}

.param-inline-delete__icon {
  width: 11px;
  height: 11px;
  color: currentcolor;
}

.param-delete-button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  justify-self: end;
  width: 18px;
  height: 18px;
  padding: 0;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: calc(var(--radius) * 0.62);
}

.param-delete-button:hover {
  color: var(--el-color-danger);
  background: color-mix(
    in srgb,
    var(--el-color-danger-light-9) 70%,
    transparent
  );
}

.param-delete-icon {
  width: 12px;
  height: 12px;
}

/* 参数值编辑按钮：与行内删除按钮同款尺寸/交互，hover 用主题色区分 */
.param-edit-button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: calc(var(--radius) * 0.62);
}

.param-edit-button:hover {
  color: var(--el-color-primary);
  background: color-mix(
    in srgb,
    var(--el-color-primary-light-9) 70%,
    transparent
  );
}

.param-edit-icon {
  width: 12px;
  height: 12px;
}

/* 编辑覆盖层：absolute 铺满「请求参数」内容区（Teleport 目标），永不超出面板 */
.param-editor-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  background: color-mix(in srgb, var(--el-bg-color) 55%, transparent);
  backdrop-filter: blur(2px);
}

.param-editor {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 560px;
  min-height: 0;

  /* 限制在覆盖层内（已含 padding），卡片高度自适应且不溢出面板 */
  max-height: 100%;
  padding: 16px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: calc(var(--radius) * 0.94);
  box-shadow: var(--el-box-shadow-light);
}

.param-editor__header {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.param-editor__textarea {
  box-sizing: border-box;

  /* flex 撑满受限的卡片高度，超出时内部滚动；禁用手动 resize 以免拖出面板 */
  flex: 1 1 auto;
  width: 100%;
  min-height: 180px;
  padding: 10px 12px;
  overflow: auto;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-primary);
  resize: none;
  background: var(--el-fill-color-blank);
  border: 1px solid var(--el-border-color);
  border-radius: calc(var(--radius) * 0.72);
}

.param-editor__textarea:focus {
  outline: none;
  border-color: var(--el-color-primary);
}

.param-editor__footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
