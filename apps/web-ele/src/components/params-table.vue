<script lang="ts" setup>
import type {
  CheckboxValueType,
  UploadFile,
  UploadFiles,
  UploadInstance,
  UploadProps,
  UploadRawFile,
} from 'element-plus';

import { computed, ref } from 'vue';

import { SvgCloseIcon } from '@vben/icons';

import {
  ElButton,
  ElCheckbox,
  ElIcon,
  ElInput,
  ElOption,
  ElSelect,
  ElTable,
  ElTableColumn,
  ElUpload,
  genFileId,
} from 'element-plus';

interface ParamItem {
  enabled: boolean;
  name: string;
  value: any;
  description?: string;
  type?: string;
  format?: string;
  required?: boolean;
  enum?: number[] | string[];
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

const props = defineProps<{
  tableData: ParamItem[];
}>();
const tableRef = ref();
const fileList = ref([]);
const uploadRef = ref<UploadInstance>();

// 判断是否为枚举参数
function isEnumParam(row: ParamItem) {
  return (
    (row.enum && row.enum.length > 0) ||
    (row.schema?.enum && row.schema.enum.length > 0) ||
    (row.schema?.items?.enum && row.schema.items.enum.length > 0)
  );
}

// 获取枚举选项
function getEnumOptions(row: ParamItem) {
  const enumValues: (number | string)[] =
    row.enum || row.schema?.enum || row.schema?.items?.enum || [];
  return enumValues.map((value) => ({
    label: String(value),
    value,
    description: undefined,
  }));
}

// 获取输入框占位符
function getPlaceholder(row: ParamItem) {
  if (row.description) return row.description;
  if (row.type) return row.type;
  return '请输入参数值';
}

// 删除参数
function remove(index: number) {
  // eslint-disable-next-line vue/no-mutating-props
  props.tableData.splice(index, 1);
}

// 添加参数
function add() {
  // eslint-disable-next-line vue/no-mutating-props
  props.tableData.push({ name: '', value: '', enabled: true });
}

// 全选控制，保护必填参数
const allChecked = computed({
  get: () => !props.tableData.some((item) => !item.enabled),
  set: (value: boolean) => {
    props.tableData.forEach((item) => {
      if (!item.required) item.enabled = value;
    });
  },
});

function handleChange(value: CheckboxValueType) {
  allChecked.value = value as boolean;
}

// 文件上传处理
function handleUpload(
  _uploadFile: UploadFile,
  uploadFiles: UploadFiles,
  row: ParamItem,
) {
  const rawFiles = uploadFiles
    .filter((f) => f.raw)
    .map((f) => f.raw) as UploadRawFile[];
  row.value = rawFiles.length > 0 ? rawFiles : '';
}

// 超出文件数量限制处理
const handleExceed: UploadProps['onExceed'] = (files) => {
  uploadRef.value!.clearFiles();
  const file = files[0] as UploadRawFile;
  file.uid = genFileId();
  uploadRef.value!.handleStart(file);
};
</script>

<template>
  <div>
    <ElTable
      ref="tableRef"
      border
      class="params-table"
      :data="tableData"
      header-cell-class-name="p-2"
    >
      <ElTableColumn :width="55" align="center">
        <template #header>
          <ElCheckbox v-model="allChecked" @change="handleChange" />
        </template>
        <template #default="{ row }">
          <ElCheckbox v-model="row.enabled" />
        </template>
      </ElTableColumn>
      <ElTableColumn prop="name" label="参数名">
        <template #default="{ row }">
          <ElInput v-model="row.name" placeholder="参数名" />
        </template>
      </ElTableColumn>
      <ElTableColumn prop="value" label="参数值">
        <template #default="{ row, $index }">
          <div v-if="row.format === 'binary'" class="pl-2 pt-2">
            <ElUpload
              ref="uploadRef"
              v-model:file-list="fileList"
              action="#"
              :auto-upload="false"
              :on-change="(file, files) => handleUpload(file, files, row)"
              :on-remove="(file, files) => handleUpload(file, files, row)"
              :multiple="row.type === 'array'"
              :limit="row.type === 'array' ? 99 : 1"
              :on-exceed="handleExceed"
            >
              <ElButton plain size="small"> 上传 </ElButton>
            </ElUpload>
          </div>

          <!-- 枚举类型 -->
          <div v-else-if="isEnumParam(row)" class="flex items-center">
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
            <ElIcon @click="remove($index)" class="ml-2 cursor-pointer">
              <SvgCloseIcon class="size-3" />
            </ElIcon>
          </div>

          <!-- 普通输入框 -->
          <div v-else class="flex items-center">
            <ElInput v-model="row.value" :placeholder="getPlaceholder(row)" />
            <ElIcon @click="remove($index)" class="cursor-pointer">
              <SvgCloseIcon class="ml-[-12px] size-3" />
            </ElIcon>
          </div>
        </template>
      </ElTableColumn>
    </ElTable>
    <ElButton style="width: 100%" @click="add"> 添加参数 </ElButton>
  </div>
</template>
<style lang="scss" scoped></style>
