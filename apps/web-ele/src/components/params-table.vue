<script lang="ts" setup>
import type {
  CheckboxValueType,
  UploadFile,
  UploadFiles,
  UploadProps,
  UploadRawFile,
} from 'element-plus';

import { computed, watch } from 'vue';

import { SvgCloseIcon } from '@vben/icons';

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

interface ParamItem {
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
  };
}

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
  return row.description?.trim() || '';
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

function add() {
  // eslint-disable-next-line vue/no-mutating-props
  props.tableData.push({
    name: '',
    value: '',
    enabled: true,
    fileList: [],
    contentType: undefined,
  });
}

function handleUpload(
  _uploadFile: UploadFile,
  uploadFiles: UploadFiles,
  row: ParamItem,
) {
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
  <div class="params-table-wrap">
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
          v-for="(row, index) in tableData"
          :key="`${row.name || 'row'}-${index}`"
          class="params-grid-table__row"
          :style="rowStyle"
        >
          <div
            v-if="showSelectionColumn"
            class="params-grid-table__cell params-grid-table__cell--selection params-grid-table__cell--body"
          >
            <ElCheckbox v-model="row.enabled" />
          </div>

          <div class="params-grid-table__cell params-grid-table__cell--body">
            <ElInput v-model="row.name" placeholder="参数名" />
          </div>

          <div class="params-grid-table__cell params-grid-table__cell--body">
            <div
              v-if="row.format === 'binary'"
              class="params-grid-table__control"
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
              <ElInput v-model="row.value" :placeholder="getPlaceholder(row)" />
              <button
                v-if="showInlineDelete"
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
            <div class="param-description-cell">
              <span class="param-description-main">
                <ElTooltip
                  v-if="getDescription(row)"
                  :content="getDescription(row)"
                  placement="top"
                >
                  <span class="param-description-text">
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
                <svg
                  class="param-delete-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M3 6.38597C3 5.90152 3.34538 5.50879 3.77143 5.50879L6.43567 5.50832C6.96502 5.49306 7.43202 5.11033 7.61214 4.54412C7.61688 4.52923 7.62232 4.51087 7.64185 4.44424L7.75665 4.05256C7.8269 3.81241 7.8881 3.60318 7.97375 3.41617C8.31209 2.67736 8.93808 2.16432 9.66147 2.03297C9.84457 1.99972 10.0385 1.99986 10.2611 2.00002H13.7391C13.9617 1.99986 14.1556 1.99972 14.3387 2.03297C15.0621 2.16432 15.6881 2.67736 16.0264 3.41617C16.1121 3.60318 16.1733 3.81241 16.2435 4.05256L16.3583 4.44424C16.3778 4.51087 16.3833 4.52923 16.388 4.54412C16.5682 5.11033 17.1278 5.49353 17.6571 5.50879H20.2286C20.6546 5.50879 21 5.90152 21 6.38597C21 6.87043 20.6546 7.26316 20.2286 7.26316H3.77143C3.34538 7.26316 3 6.87043 3 6.38597Z"
                    fill="currentColor"
                  />
                  <path
                    fill-rule="evenodd"
                    clip-rule="evenodd"
                    d="M9.42543 11.4815C9.83759 11.4381 10.2051 11.7547 10.2463 12.1885L10.7463 17.4517C10.7875 17.8855 10.4868 18.2724 10.0747 18.3158C9.66253 18.3592 9.29499 18.0426 9.25378 17.6088L8.75378 12.3456C8.71256 11.9118 9.01327 11.5249 9.42543 11.4815Z"
                    fill="currentColor"
                  />
                  <path
                    fill-rule="evenodd"
                    clip-rule="evenodd"
                    d="M14.5747 11.4815C14.9868 11.5249 15.2875 11.9118 15.2463 12.3456L14.7463 17.6088C14.7051 18.0426 14.3376 18.3592 13.9254 18.3158C13.5133 18.2724 13.2126 17.8855 13.2538 17.4517L13.7538 12.1885C13.795 11.7547 14.1625 11.4381 14.5747 11.4815Z"
                    fill="currentColor"
                  />
                  <path
                    opacity="0.5"
                    d="M11.5956 22.0001H12.4044C15.1871 22.0001 16.5785 22.0001 17.4831 21.1142C18.3878 20.2283 18.4803 18.7751 18.6654 15.8686L18.9321 11.6807C19.0326 10.1037 19.0828 9.31524 18.6289 8.81558C18.1751 8.31592 17.4087 8.31592 15.876 8.31592H8.12405C6.59127 8.31592 5.82488 8.31592 5.37105 8.81558C4.91722 9.31524 4.96744 10.1037 5.06788 11.6807L5.33459 15.8686C5.5197 18.7751 5.61225 20.2283 6.51689 21.1142C7.42153 22.0001 8.81289 22.0001 11.5956 22.0001Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ElButton v-if="showAddButton" class="params-table-add" @click="add">
      添加参数
    </ElButton>
  </div>
</template>

<style lang="scss" scoped>
.params-table-wrap {
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

.params-table-add {
  width: 100%;
  min-width: 0;
  min-height: 32px;
  font-size: 12px;
}

.params-table-add :deep(span) {
  line-height: 1;
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
</style>
