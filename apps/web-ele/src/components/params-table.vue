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
  ElTable,
  ElTableColumn,
  ElUpload,
  genFileId,
} from 'element-plus';

const props = defineProps<{
  tableData: {
    description?: string;
    enabled: boolean;
    name: string;
    type?: string;
    value: any;
  }[];
}>();
const tableRef = ref();
const fileList = ref([]);
const uploadRef = ref<UploadInstance>();
const remove = (index: number) => {
  // eslint-disable-next-line vue/no-mutating-props
  props.tableData.splice(index, 1);
};
const add = () => {
  // eslint-disable-next-line vue/no-mutating-props
  props.tableData.push({ name: '', value: '', enabled: true });
};
const allChecked = computed({
  get: () => {
    return !props.tableData.some((item) => !item.enabled);
  },
  set: (value) => {
    props.tableData.forEach((item) => {
      item.enabled = value;
    });
  },
});
const handleChange = (value: CheckboxValueType) => {
  allChecked.value = value as boolean;
};
const handleUpload: (
  uploadFile: UploadFile,
  uploadFiles: UploadFiles,
  row: {
    description?: string;
    enabled: boolean;
    name: string;
    type?: string;
    value: any;
  },
) => void = (uploadFile, uploadFiles, row) => {
  if (uploadFiles.length > 0) {
    const rawFiles = uploadFiles
      .filter((item) => item.raw !== undefined)
      .map((item) => item.raw) as UploadRawFile[];
    row.value = rawFiles;
  } else {
    row.value = '';
  }
};
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
              :on-change="
                (uploadFile, uploadFiles) =>
                  handleUpload(uploadFile, uploadFiles, row)
              "
              :on-remove="
                (uploadFile, uploadFiles) =>
                  handleUpload(uploadFile, uploadFiles, row)
              "
              :multiple="row.type === 'array'"
              :limit="row.type === 'array' ? 99 : 1"
              :on-exceed="handleExceed"
            >
              <ElButton plain size="small"> 上传 </ElButton>
            </ElUpload>
          </div>
          <div class="flex items-center" v-else>
            <ElInput v-model="row.value" />
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
