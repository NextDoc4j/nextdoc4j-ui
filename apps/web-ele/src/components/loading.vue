<script lang="ts" setup></script>
<template>
  <div class="flex h-full items-center justify-center">
    <div class="loading-container">
      <div class="loader"></div>
    </div>
  </div>
</template>
<style lang="scss">
@keyframes jump-ani {
  15% {
    border-bottom-right-radius: 3px;
  }

  25% {
    transform: translateY(9px) rotate(22.5deg);
  }

  50% {
    border-bottom-right-radius: 40px;
    transform: translateY(18px) scale(1, 0.9) rotate(45deg);
  }

  75% {
    transform: translateY(9px) rotate(67.5deg);
  }

  100% {
    transform: translateY(0) rotate(90deg);
  }
}

@keyframes shadow-ani {
  0%,
  100% {
    transform: scale(1, 1);
  }

  50% {
    transform: scale(1.2, 1);
  }
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

/* From Uiverse.io by gharsh11032000 */
.loader {
  position: relative;
  width: 48px;
  height: 48px;
}

.loader::before {
  position: absolute;
  top: 60px;
  left: 0;
  width: 48px;
  height: 5px;
  content: '';
  background: linear-gradient(-45deg, #fc00ff 0%, #00dbde 100%);
  border-radius: 50%;
  animation: shadow-ani 0.5s linear infinite;
}

.loader::after {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  content: '';
  background: linear-gradient(-45deg, #fc00ff 0%, #00dbde 100%);
  border-radius: 4px;
  animation: jump-ani 0.5s linear infinite;
}
</style>
